-- Conteo por casillero: pararse frente a un casillero (E2-N5, C1-A, D1…), escanear o buscar lo que hay y escribir
-- cuánto hay de cada cosa. En una sola pasada:
--   1. el producto queda ubicado en ese casillero (si no lo estaba),
--   2. la cantidad del casillero (product_locations.qty) queda con lo contado,
--   3. el stock (products.stock) se corrige con un movimiento de ajuste, si se puede saber el total:
--      lo contado aquí + lo anotado en sus otras ubicaciones. Si alguna otra ubicación no tiene cantidad
--      (nunca se contó), el stock no se toca y se avisa que falta contar allí.
-- Antes había que hacer tres cosas por separado (ubicar, anotar la cantidad y ajustar el stock).
--
-- Stock "al momento de contar": el conteo se puede guardar horas después de hecho (el borrador queda en el
-- equipo). Si la diferencia se calcula contra el stock del momento de guardar, las ventas hechas entre el conteo
-- y el guardado se borran del stock (se contaron 10, se vendieron 2, al guardar quedaba 10 en vez de 8). Ahora cada
-- línea lleva la hora en que se contó (counted_at) y la diferencia se calcula contra el stock que había a esa hora:
-- stock actual menos los movimientos posteriores. Una venta cuenta por su hora de venta (sold_at, que en las
-- ventas sin internet es anterior a la sincronización), lo demás por la hora del movimiento. Los ajustes
-- posteriores no se descuentan: no son mercadería que entró o salió, sino otra corrección del mismo stock.
-- bulk_adjust_stock (Conteo de stock) usa la misma regla; si una línea no trae counted_at, se comporta como antes.

-- Stock de un producto a una hora dada: el actual menos la mercadería que entró o salió después
-- (ventas, anulaciones, compras, devoluciones; no los ajustes).
create or replace function public.stock_at(p_product_id uuid, p_at timestamptz)
returns numeric language sql stable set search_path = public as $$
  select p.stock - coalesce((
           select sum(m.qty)
             from stock_movements m left join sales s on s.id = m.sale_id
            where m.product_id = p_product_id
              and m.reason <> 'ajuste'
              and m.created_at > p_at                       -- usa el índice (product_id, created_at)
              and coalesce(s.sold_at, m.created_at) > p_at), 0)
    from products p where p.id = p_product_id
$$;
-- Solo la usan las RPC de conteo.
revoke execute on function public.stock_at(uuid, timestamptz) from public, anon, authenticated;

-- Hora de conteo válida: la enviada, sin pasar de ahora (relojes adelantados) ni ser de hace más de 30 días.
create or replace function public.count_time(p text)
returns timestamptz language sql stable set search_path = public as $$
  select case when t is null or t > now() then now()
              when t < now() - interval '30 days' then now() - interval '30 days'
              else t end
    from (select nullif(p, '')::timestamptz as t) x
$$;
revoke execute on function public.count_time(text) from public, anon, authenticated;

-- Conteo de stock (pantalla Conteo de stock): igual que antes, ahora contra el stock al momento de contar.
-- p_items = [{ "product_id": uuid, "counted": numeric, "counted_at"?: timestamptz }, ...]
create or replace function public.bulk_adjust_stock(p_items jsonb, p_note text default 'Conteo físico')
returns integer language plpgsql security definer set search_path = public as $$
declare v_changed integer;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  with counted as (
    select (i->>'product_id')::uuid as product_id, (i->>'counted')::numeric as counted,
           public.count_time(i->>'counted_at') as counted_at
    from jsonb_array_elements(p_items) i
  ), locked as (
    select p.id from products p join counted c on c.product_id = p.id for update of p
  ), diffs as (
    select c.product_id as id, c.counted - public.stock_at(c.product_id, c.counted_at) as diff
    from counted c join locked l on l.id = c.product_id
  ), ins as (
    insert into stock_movements (product_id, qty, reason, note)
    select id, diff, 'ajuste', p_note from diffs where diff <> 0
    returning 1
  )
  select count(*) into v_changed from ins;
  return v_changed;
end $$;
revoke execute on function public.bulk_adjust_stock(jsonb, text) from public, anon;
grant  execute on function public.bulk_adjust_stock(jsonb, text) to authenticated;

-- Conteo de un casillero.
-- p = { "location_id": bigint, "note"?: text,
--       "items": [{ "product_id": uuid, "counted": numeric, "counted_at"?: timestamptz, "remove"?: bool }] }
--   remove = true: el producto ya no va en este casillero (se quita la ubicación; cuenta como 0 aquí).
-- Devuelve { ubicados, quitados, ajustados, sin_ajuste: [{ product_id, name, pendientes: ["E3-N2", …] }] }.
create or replace function public.count_location(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loc      locations;
  v_note     text;
  v_item     jsonb;
  v_pid      uuid;
  v_prod     products;
  v_counted  numeric;
  v_at       timestamptz;
  v_remove   boolean;
  v_other    numeric;
  v_pending  text[];
  v_diff     numeric;
  v_moves    jsonb := '[]';
  v_skipped  jsonb := '[]';
  v_placed   int := 0;
  v_removed  int := 0;
  v_adjusted int := 0;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into v_loc from locations where id = (p->>'location_id')::bigint;
  if not found then raise exception 'La ubicación no existe'; end if;
  v_note := coalesce(nullif(trim(p->>'note'), ''), 'Conteo de ' || v_loc.code);

  -- En orden de producto, para que dos conteos a la vez se bloqueen siempre en el mismo orden.
  for v_item in select i from jsonb_array_elements(coalesce(p->'items', '[]')) i order by i->>'product_id' loop
    v_pid     := (v_item->>'product_id')::uuid;
    v_remove  := coalesce((v_item->>'remove')::boolean, false);
    v_counted := case when v_remove then 0 else (v_item->>'counted')::numeric end;
    v_at      := public.count_time(v_item->>'counted_at');
    if v_counted is null or v_counted < 0 then
      raise exception 'Cantidad inválida en el conteo' using errcode = '22023';
    end if;

    select * into v_prod from products where id = v_pid for update;
    if not found then raise exception 'Un producto del conteo ya no existe'; end if;

    -- 1 y 2: ubicación y cantidad del casillero.
    if v_remove then
      delete from product_locations where product_id = v_pid and location_id = v_loc.id;
      if found then v_removed := v_removed + 1; end if;
    else
      update product_locations set qty = v_counted where product_id = v_pid and location_id = v_loc.id;
      if not found then
        insert into product_locations (product_id, location_id, qty) values (v_pid, v_loc.id, v_counted);
        v_placed := v_placed + 1;
      end if;
    end if;

    -- 3: stock, si el total se conoce.
    if not v_prod.track_stock then continue; end if;
    select coalesce(sum(pl.qty), 0), array_agg(l.code order by l.code) filter (where pl.qty is null)
      into v_other, v_pending
      from product_locations pl join locations l on l.id = pl.location_id
     where pl.product_id = v_pid and pl.location_id <> v_loc.id;
    if v_pending is not null then
      v_skipped := v_skipped || jsonb_build_object('product_id', v_pid, 'name', v_prod.name, 'pendientes', to_jsonb(v_pending));
      continue;
    end if;
    v_diff := (v_counted + v_other) - public.stock_at(v_pid, v_at);
    if v_diff <> 0 then
      v_moves := v_moves || jsonb_build_object('product_id', v_pid, 'qty', v_diff);
      v_adjusted := v_adjusted + 1;
    end if;
  end loop;

  -- Una sola sentencia: en Actividad queda una línea "Conteo de E2-N5: N productos ajustados".
  insert into stock_movements (product_id, qty, reason, note)
  select m.product_id, m.qty, 'ajuste', v_note from jsonb_to_recordset(v_moves) as m(product_id uuid, qty numeric);

  return jsonb_build_object('ubicados', v_placed, 'quitados', v_removed, 'ajustados', v_adjusted, 'sin_ajuste', v_skipped);
end $$;
revoke execute on function public.count_location(jsonb) from public, anon;
grant  execute on function public.count_location(jsonb) to authenticated;
