-- Módulo de proveedores / compras.
-- * Número correlativo legible (OC-0001), referencia de factura/guía y si los costos vienen con IGV.
-- * Guardado atómico de la orden (cabecera + líneas) con save_purchase_order.
-- * Reglas de estado: una orden recibida no se modifica ni se borra, y solo se recibe por RPC
--   (así el stock y el costo siempre se mueven juntos con el cambio de estado).
-- * receive_purchase_order devuelve un resumen (costo anterior → nuevo, precio) para revisar márgenes.

alter table purchase_orders
  add column number            bigint generated always as identity,
  add column invoice_ref       text,
  add column costs_include_igv boolean not null default true;
create unique index purchase_orders_number_key on purchase_orders (number);
create index purchase_orders_status_idx on purchase_orders (status, created_at desc);

-- Total a pagar (con IGV), a partir de las líneas.
create or replace function public.po_total(p_po_id uuid) returns numeric
language sql stable set search_path = public as $$
  select round(coalesce(sum(i.subtotal), 0) * case when o.costs_include_igv then 1 else 1.18 end, 2)
    from purchase_orders o left join purchase_order_items i on i.po_id = o.id
   where o.id = p_po_id
   group by o.costs_include_igv
$$;

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
  if new.status = 'enviada' and old.status <> 'enviada' and new.ordered_at is null then
    new.ordered_at := now();
  end if;
  return new;
end $$;
create trigger purchase_orders_guard before update or delete on purchase_orders
  for each row execute function po_guard();

create or replace function public.po_items_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from purchase_orders where id = coalesce(new.po_id, old.po_id) and status = 'recibida') then
    raise exception 'La orden ya fue recibida: no se puede modificar';
  end if;
  return coalesce(new, old);
end $$;
create trigger purchase_order_items_guard before insert or update or delete on purchase_order_items
  for each row execute function po_items_guard();

-- ---------- RPC: guardar orden (cabecera + reemplazo de líneas) ----------
-- p = { id?, provider_id, note?, invoice_ref?, costs_include_igv?, items: [{ product_id, qty, unit_cost }] }
-- security invoker: aplica RLS (admin/almacén).
create or replace function public.save_purchase_order(p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
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
     where id = v_id and status in ('borrador', 'enviada');
    if not found then raise exception 'La orden no existe o ya no se puede editar'; end if;
    delete from purchase_order_items where po_id = v_id;
  end if;

  insert into purchase_order_items (po_id, product_id, qty, unit_cost)
  select v_id, (i->>'product_id')::uuid, (i->>'qty')::numeric, (i->>'unit_cost')::numeric
    from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) i;

  update purchase_orders set total = public.po_total(v_id) where id = v_id;
  return v_id;
end $$;

-- ---------- RPC: recibir orden ----------
-- Entra el stock, el costo del producto pasa a ser el de esta compra (con IGV; si un producto viene
-- en varias líneas se promedia) y, si el producto no tenía proveedor, queda asignado a este.
drop function public.receive_purchase_order(uuid);
create function public.receive_purchase_order(p_po_id uuid) returns jsonb
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
  if not found or v_po.status not in ('borrador', 'enviada') then
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

  insert into product_costs (product_id, cost)
  select product_id, cost from _po_lines
  on conflict (product_id) do update set cost = excluded.cost, updated_at = now();

  update products set provider_id = v_po.provider_id
   where id in (select product_id from _po_lines) and provider_id is null;

  return v_summary;
end $$;

revoke execute on function public.save_purchase_order(jsonb)     from public, anon;
revoke execute on function public.receive_purchase_order(uuid)   from public, anon;
revoke execute on function public.po_total(uuid)                 from public, anon;
grant  execute on function public.save_purchase_order(jsonb)     to authenticated;
grant  execute on function public.receive_purchase_order(uuid)   to authenticated;
grant  execute on function public.po_total(uuid)                 to authenticated;
