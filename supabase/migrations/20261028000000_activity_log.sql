-- Bitácora de actividad (pantalla "Actividad", solo admin): quién hizo qué y cuándo.
-- La llenan triggers, así queda todo lo que cambia la base venga de donde venga: el POS, el celular o las
-- cargas de Claude (habilidades facturas/stock, que fijan app.origen = 'claude').
--   venta    → registrada, anulada
--   producto → creado, editado (qué campos, antes → después), foto subida/quitada, costo cambiado a mano, eliminado
--   compra   → orden creada, enviada, recibida, cancelada, eliminada
--   stock    → ajuste o conteo físico (una línea por operación, con el detalle por producto)
-- Lo que se escribe aquí es solo para leer: nadie lo edita desde la app (sin políticas de escritura).
-- Si registrar algo falla, se deja un aviso en el log de Postgres y la venta/compra/ajuste sigue igual.

create table activity_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id   uuid references auth.users(id) on delete set null,
  actor_name text,   -- nombre al momento; null = sin usuario (SQL directo)
  via        text,   -- 'claude' si lo cargó Claude (app.origen)
  kind       text not null check (kind in ('venta', 'producto', 'compra', 'stock')),
  action     text not null,
  entity_id  text,   -- id de la venta, producto u orden
  summary    text not null,
  details    jsonb not null default '{}'
);
create index activity_log_created_idx on activity_log (created_at desc);
create index activity_log_kind_idx    on activity_log (kind, created_at desc);
create index activity_log_actor_idx   on activity_log (actor_id, created_at desc);
create index activity_log_entity_idx  on activity_log (entity_id);

alter table activity_log enable row level security;
create policy activity_log_read on activity_log for select to authenticated
  using ((select public.has_role('admin')));

-- ---------- Utilidades ----------
create or replace function public.log_activity(p_kind text, p_action text, p_entity text, p_summary text,
                                               p_details jsonb default '{}', p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := coalesce(p_actor, auth.uid());
begin
  insert into activity_log (actor_id, actor_name, via, kind, action, entity_id, summary, details)
  values (v_actor, (select nullif(full_name, '') from profiles where id = v_actor),
          nullif(current_setting('app.origen', true), ''),
          p_kind, p_action, p_entity, p_summary, coalesce(p_details, '{}'));
end $$;

create or replace function public.activity_money(n numeric) returns text
language sql immutable set search_path = public as $$
  select 'S/ ' || to_char(coalesce(n, 0), 'FM999999990.00')
$$;

create or replace function public.activity_po_label(p purchase_orders) returns text
language sql stable set search_path = public as $$
  select 'OC-' || lpad(p.number::text, 4, '0')
         || coalesce(' · ' || (select name from providers where id = p.provider_id), '')
         || coalesce(' · ' || p.invoice_ref, '')
$$;

-- ---------- Ventas ----------
-- Al confirmar la transacción (trigger diferido): create_sale inserta con total 0 y lo completa al final.
create or replace function public.log_sale_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v       sales;
  v_items int;
begin
  begin
    select * into v from sales where id = new.id;
    if not found or v.legacy_ref is not null then return null; end if;   -- importación de la app antigua
    select count(*) into v_items from sale_items where sale_id = v.id;
    perform log_activity('venta', 'venta_registrada', v.id::text,
      format('Venta #%s · %s · %s · %s', v.number, activity_money(v.total),
             case v.caja when 'copias' then 'Copias y librería' else 'Ferretería' end, initcap(v.payment_method::text)),
      jsonb_build_object('number', v.number, 'total', v.total, 'caja', v.caja, 'payment_method', v.payment_method,
                         'items', v_items, 'sold_at', v.sold_at, 'customer_name', v.customer_name),
      v.cashier_id);
    return null;
  exception when others then
    raise warning 'activity_log (log_sale_created): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create constraint trigger sales_activity_created after insert on sales
  deferrable initially deferred for each row execute function log_sale_created();

create or replace function public.log_sale_voided() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if old.status = 'completada' and new.status = 'anulada' then
      perform log_activity('venta', 'venta_anulada', new.id::text,
        format('Venta #%s anulada · %s', new.number, activity_money(new.total)),
        jsonb_build_object('number', new.number, 'total', new.total, 'caja', new.caja, 'cashier_id', new.cashier_id),
        new.voided_by);
    end if;
    return null;
  exception when others then
    raise warning 'activity_log (log_sale_voided): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create trigger sales_activity_voided after update of status on sales
  for each row execute function log_sale_voided();

-- ---------- Productos ----------
-- Edición: solo los campos que cambiaron. stock/updated_at no cuentan (los mueve cada venta, compra o ajuste).
create or replace function public.log_product_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb := '{}';
  v_key     text;
  v_action  text;
begin
  begin
    if tg_op = 'INSERT' then
      perform log_activity('producto', 'producto_creado', new.id::text,
        format('Producto creado: %s (%s)', new.name, new.sku),
        jsonb_build_object('sku', new.sku, 'name', new.name, 'price', new.price, 'unit', new.unit, 'active', new.active));
      return null;
    end if;
    if tg_op = 'DELETE' then
      perform log_activity('producto', 'producto_eliminado', old.id::text,
        format('Producto eliminado: %s (%s)', old.name, old.sku),
        jsonb_build_object('sku', old.sku, 'name', old.name));
      return null;
    end if;

    v_old := to_jsonb(old) - array['stock', 'updated_at', 'created_at'];
    v_new := to_jsonb(new) - array['stock', 'updated_at', 'created_at'];
    if v_old = v_new then return null; end if;

    for v_key in select key from jsonb_each(v_new) where v_new->key is distinct from v_old->key loop
      v_changes := v_changes || jsonb_build_object(v_key, case v_key
        -- Categoría y proveedor por nombre (el id no le dice nada a nadie).
        when 'category_id' then jsonb_build_object(
          'antes',   (select name from categories where id = old.category_id),
          'despues', (select name from categories where id = new.category_id))
        when 'provider_id' then jsonb_build_object(
          'antes',   (select name from providers where id = old.provider_id),
          'despues', (select name from providers where id = new.provider_id))
        else jsonb_build_object('antes', v_old->v_key, 'despues', v_new->v_key) end);
    end loop;

    -- Al recibir una compra el producto sin proveedor queda con el de la orden: ya lo dice "compra recibida".
    if v_changes = jsonb_build_object('provider_id', v_changes->'provider_id')
       and old.provider_id is null
       and exists (select 1 from stock_movements where product_id = new.id and reason = 'compra' and created_at = now()) then
      return null;
    end if;

    v_action := case
      when v_changes = jsonb_build_object('image_path', v_changes->'image_path')
        then case when new.image_path is null then 'foto_quitada' else 'foto_subida' end
      else 'producto_editado' end;
    perform log_activity('producto', v_action, new.id::text,
      format('%s: %s (%s)',
             case v_action when 'foto_subida' then 'Foto subida' when 'foto_quitada' then 'Foto quitada' else 'Producto editado' end,
             new.name, new.sku),
      jsonb_build_object('sku', new.sku, 'name', new.name, 'changes', v_changes));
    return null;
  exception when others then
    raise warning 'activity_log (log_product_change): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create trigger products_activity after insert or update or delete on products
  for each row execute function log_product_change();

-- Costo cambiado a mano (editor de inventario). El de las compras ya lo cuenta "compra recibida".
create or replace function public.log_cost_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old numeric := case when tg_op = 'UPDATE' then old.cost end;
begin
  begin
    if coalesce(current_setting('app.cost_source', true), '') = 'compra' then return null; end if;
    if v_old is not distinct from new.cost then return null; end if;
    perform log_activity('producto', 'costo_editado', new.product_id::text,
      format('Costo de %s: %s', p.name,
             case when v_old is null then activity_money(new.cost)
                  else activity_money(v_old) || ' → ' || activity_money(new.cost) end),
      jsonb_build_object('sku', p.sku, 'name', p.name, 'changes',
                         jsonb_build_object('cost', jsonb_build_object('antes', v_old, 'despues', new.cost))))
      from products p where p.id = new.product_id;
    return null;
  exception when others then
    raise warning 'activity_log (log_cost_activity): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create trigger product_costs_activity after insert or update on product_costs
  for each row execute function log_cost_activity();

-- ---------- Compras ----------
-- Creada: al confirmar (save_purchase_order inserta la cabecera y luego las líneas y el total).
create or replace function public.log_po_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v       purchase_orders;
  v_items int;
begin
  begin
    select * into v from purchase_orders where id = new.id;
    if not found then return null; end if;
    select count(*) into v_items from purchase_order_items where po_id = v.id;
    perform log_activity('compra', 'compra_creada', v.id::text,
      format('Orden de compra creada: %s · %s · %s producto%s', activity_po_label(v), activity_money(v.total),
             v_items, case when v_items = 1 then '' else 's' end),
      jsonb_build_object('number', v.number, 'total', v.total, 'items', v_items, 'invoice_ref', v.invoice_ref,
                         'status', v.status),
      coalesce(auth.uid(), v.created_by));
    return null;
  exception when others then
    raise warning 'activity_log (log_po_created): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create constraint trigger purchase_orders_activity_created after insert on purchase_orders
  deferrable initially deferred for each row execute function log_po_created();

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
             case new.status when 'recibida' then 'Compra recibida (entró al stock)'
                             when 'enviada' then 'Orden de compra enviada'
                             when 'cancelada' then 'Orden de compra cancelada'
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
create trigger purchase_orders_activity after update or delete on purchase_orders
  for each row execute function log_po_change();

-- ---------- Stock ----------
-- Ajustes y conteos: una línea por sentencia y nota (bulk_adjust_stock inserta todo el conteo de una vez),
-- con cada producto, la diferencia y el stock con que quedó. Ventas y compras ya tienen su propia línea.
create or replace function public.log_stock_adjust() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_one  jsonb;
begin
  begin
    for r in
      select nullif(m.note, '') as note, count(*) as n,
             jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit,
                                          'qty', m.qty, 'stock', p.stock) order by p.name) as items
        from new_rows m join products p on p.id = m.product_id
       where m.reason = 'ajuste'
       group by nullif(m.note, '')
    loop
      v_one := r.items->0;
      perform log_activity('stock', case when r.n = 1 then 'stock_ajuste' else 'stock_conteo' end,
        case when r.n = 1 then v_one->>'product_id' end,
        case when r.n = 1
          then format('Ajuste de stock: %s %s%s %s (queda %s)', v_one->>'name',
                      case when (v_one->>'qty')::numeric > 0 then '+' else '' end,
                      trim_scale((v_one->>'qty')::numeric), v_one->>'unit', trim_scale((v_one->>'stock')::numeric))
          else format('%s: %s productos ajustados', coalesce(r.note, 'Conteo de stock'), r.n) end,
        jsonb_build_object('note', r.note, 'items', r.items));
    end loop;
    return null;
  exception when others then
    raise warning 'activity_log (log_stock_adjust): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create trigger stock_movements_activity after insert on stock_movements
  referencing new table as new_rows for each statement execute function log_stock_adjust();

-- Solo los usan los triggers (dueño postgres); nadie los llama desde la API.
revoke execute on function public.log_activity(text, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.activity_money(numeric)                  from public, anon, authenticated;
revoke execute on function public.activity_po_label(purchase_orders)      from public, anon, authenticated;
revoke execute on function public.log_sale_created()   from public, anon, authenticated;
revoke execute on function public.log_sale_voided()    from public, anon, authenticated;
revoke execute on function public.log_product_change() from public, anon, authenticated;
revoke execute on function public.log_cost_activity()  from public, anon, authenticated;
revoke execute on function public.log_po_created()     from public, anon, authenticated;
revoke execute on function public.log_po_change()      from public, anon, authenticated;
revoke execute on function public.log_stock_adjust()   from public, anon, authenticated;
