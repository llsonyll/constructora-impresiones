-- Pedir precios al proveedor como paso propio de la orden de compra (antes era una orden "enviada" sin costos,
-- indistinguible de un pedido en firme).
--   borrador   : la lista se está armando.
--   solicitada : se le pidieron precios al proveedor (WhatsApp o PDF "Solicitud de precios"). Fecha: quote_requested_at.
--   cotizada   : el proveedor respondió y todas las líneas tienen costo. Fecha: quoted_at. Pasa sola al guardar la
--                orden con todos los costos (y vuelve a solicitada si se borra alguno).
--   enviada    : pedido hecho al proveedor (desde borrador, solicitada o cotizada). Fecha: ordered_at.
--   recibida   : por receive_purchase_order, desde cualquier estado abierto y con todos los costos.
--   cancelada  : desde cualquier estado abierto; "Reabrir" la devuelve a borrador.
-- Volver a borrador (deshacer un envío o reabrir) limpia las fechas de los pasos posteriores.

alter table purchase_orders
  add column if not exists quote_requested_at timestamptz,
  add column if not exists quoted_at          timestamptz;

-- ---------- Reglas de estado ----------
create or replace function public.po_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'recibida' then raise exception 'Una orden recibida no se puede eliminar'; end if;
    return old;
  end if;
  if old.status = 'recibida' and (new.status <> 'recibida' or new.provider_id <> old.provider_id
                                  or new.costs_include_igv <> old.costs_include_igv) then
    raise exception 'La orden ya fue recibida: no se puede modificar';
  end if;
  if new.status = 'recibida' and old.status <> 'recibida'
     and coalesce(current_setting('app.receiving_po', true), '') <> new.id::text then
    raise exception 'Para recibir la orden usa receive_purchase_order';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'solicitada' and old.status not in ('borrador', 'cotizada') then
      raise exception 'Solo se piden precios de una orden en borrador';
    end if;
    if new.status = 'cotizada' and old.status <> 'solicitada' then
      raise exception 'Solo pasa a "precios recibidos" una orden con precios pedidos';
    end if;
    if new.status = 'enviada' and old.status not in ('borrador', 'solicitada', 'cotizada') then
      raise exception 'Esta orden ya no se puede enviar';
    end if;

    if new.status = 'solicitada' then
      new.quote_requested_at := coalesce(new.quote_requested_at, now());
      new.quoted_at := null;
    elsif new.status = 'cotizada' then
      new.quoted_at := coalesce(new.quoted_at, now());
    elsif new.status = 'enviada' then
      new.ordered_at := coalesce(new.ordered_at, now());
    elsif new.status = 'borrador' then
      new.quote_requested_at := null; new.quoted_at := null; new.ordered_at := null;
    end if;
  end if;
  return new;
end $$;

-- Recibir y "precios recibidos" exigen que todas las líneas tengan costo.
create or replace function public.po_require_costs() returns trigger
language plpgsql set search_path = public as $$
declare v_missing int;
begin
  if new.status in ('recibida', 'cotizada') and old.status is distinct from new.status then
    select count(*) into v_missing from purchase_order_items where po_id = new.id and unit_cost is null;
    if v_missing > 0 then
      raise exception 'Faltan los costos de % producto(s): complétalos antes de %', v_missing,
        case new.status when 'recibida' then 'recibir' else 'darlos por recibidos' end;
    end if;
  end if;
  return new;
end $$;

-- ---------- RPC: guardar orden ----------
-- Igual que antes, editable en cualquier estado abierto. Si la orden espera precios y quedan todas las líneas
-- con costo, pasa a cotizada; si estaba cotizada y se borra un costo, vuelve a solicitada.
create or replace function public.save_purchase_order(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id      uuid := nullif(p->>'id', '')::uuid;
  v_n       int;
  v_missing int;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_id is null then
    insert into purchase_orders (provider_id, note, invoice_ref, costs_include_igv)
    values ((p->>'provider_id')::uuid, nullif(trim(p->>'note'), ''), nullif(trim(p->>'invoice_ref'), ''),
            coalesce((p->>'costs_include_igv')::boolean, true))
    returning id into v_id;
  else
    update purchase_orders
       set provider_id = (p->>'provider_id')::uuid,
           note = nullif(trim(p->>'note'), ''),
           invoice_ref = nullif(trim(p->>'invoice_ref'), ''),
           costs_include_igv = coalesce((p->>'costs_include_igv')::boolean, true)
     where id = v_id and status in ('borrador', 'solicitada', 'cotizada', 'enviada');
    if not found then raise exception 'La orden no existe o ya no se puede editar'; end if;
    delete from purchase_order_items where po_id = v_id;
  end if;

  insert into purchase_order_items (po_id, product_id, qty, unit_cost)
  select v_id, (i->>'product_id')::uuid, (i->>'qty')::numeric, (i->>'unit_cost')::numeric
    from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) i;

  select count(*), count(*) filter (where unit_cost is null) into v_n, v_missing
    from purchase_order_items where po_id = v_id;
  update purchase_orders
     set total  = public.po_total(v_id),
         status = case when status = 'solicitada' and v_n > 0 and v_missing = 0 then 'cotizada'::po_status
                       when status = 'cotizada' and (v_n = 0 or v_missing > 0) then 'solicitada'::po_status
                       else status end
   where id = v_id;
  return v_id;
end $$;

-- ---------- RPC: recibir orden ----------
-- Igual que en 20261005010000_cost_history; ahora se recibe desde cualquier estado abierto.
create or replace function public.receive_purchase_order(p_po_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_po      purchase_orders;
  v_factor  numeric;
  v_label   text;
  v_summary jsonb;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found or v_po.status not in ('borrador', 'solicitada', 'cotizada', 'enviada') then
    raise exception 'La orden no existe o ya fue procesada';
  end if;
  if not exists (select 1 from purchase_order_items where po_id = p_po_id) then
    raise exception 'La orden no tiene productos';
  end if;
  v_factor := case when v_po.costs_include_igv then 1 else 1.18 end;
  v_label  := 'OC-' || lpad(v_po.number::text, 4, '0')
              || coalesce(' · ' || (select name from providers where id = v_po.provider_id), '')
              || coalesce(' · ' || v_po.invoice_ref, '');

  create temp table _po_lines on commit drop as
  select i.product_id, sum(i.qty) as qty, round(sum(i.qty * i.unit_cost) / sum(i.qty) * v_factor, 4) as cost
    from purchase_order_items i where i.po_id = p_po_id group by i.product_id;

  -- Resumen antes de tocar costos (para mostrar costo anterior → nuevo).
  select jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'name', p.name, 'unit', p.unit, 'qty', l.qty, 'price', p.price,
           'old_cost', c.cost, 'new_cost', l.cost, 'stock', p.stock + l.qty) order by p.name)
    into v_summary
    from _po_lines l join products p on p.id = l.product_id
    left join product_costs c on c.product_id = l.product_id;

  perform set_config('app.receiving_po', p_po_id::text, true);
  update purchase_orders set status = 'recibida', received_at = now(), total = public.po_total(p_po_id)
   where id = p_po_id;
  perform set_config('app.receiving_po', '', true);

  insert into stock_movements (product_id, qty, reason, po_id, note)
  select product_id, qty, 'compra', p_po_id, v_label from _po_lines;

  insert into product_cost_history (product_id, cost, source, provider_id, po_id, qty)
  select product_id, cost, 'compra', v_po.provider_id, p_po_id, qty from _po_lines;

  -- Referencia nominal = último costo de compra (el trigger no lo duplica como 'manual').
  perform set_config('app.cost_source', 'compra', true);
  insert into product_costs (product_id, cost)
  select product_id, cost from _po_lines
  on conflict (product_id) do update set cost = excluded.cost, updated_at = now();
  perform set_config('app.cost_source', '', true);

  update products set provider_id = v_po.provider_id
   where id in (select product_id from _po_lines) and provider_id is null;

  return v_summary;
end $$;

-- ---------- Actividad: textos de los estados nuevos ----------
create or replace function public.log_po_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_items int;
begin
  begin
    if tg_op = 'DELETE' then
      if old.created_at = now() then return null; end if;   -- creada y borrada en la misma transacción: nunca existió
      perform log_activity('compra', 'compra_eliminada', old.id::text,
        format('Orden de compra eliminada: %s', activity_po_label(old)),
        jsonb_build_object('number', old.number, 'total', old.total, 'status', old.status));
      return null;
    end if;
    if new.status is not distinct from old.status then return null; end if;
    select count(*) into v_items from purchase_order_items where po_id = new.id;
    perform log_activity('compra', 'compra_' || new.status, new.id::text,
      format('%s: %s · %s · %s producto%s',
             case new.status when 'recibida'   then 'Compra recibida (entró al stock)'
                             when 'solicitada' then 'Precios pedidos al proveedor'
                             when 'cotizada'   then 'Precios recibidos del proveedor'
                             when 'enviada'    then 'Pedido enviado al proveedor'
                             when 'cancelada'  then 'Orden de compra cancelada'
                             when 'borrador'   then 'Orden de compra devuelta a borrador'
                             else 'Orden de compra en ' || new.status end,
             activity_po_label(new), activity_money(new.total), v_items, case when v_items = 1 then '' else 's' end),
      jsonb_build_object('number', new.number, 'total', new.total, 'items', v_items, 'invoice_ref', new.invoice_ref,
                         'antes', old.status, 'status', new.status));
    return null;
  exception when others then
    raise warning 'activity_log (log_po_change): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
