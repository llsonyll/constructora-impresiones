-- Conteo físico masivo: fija el stock contado de varios productos en una transacción.
-- Solo registra movimiento ('ajuste') donde hay diferencia. Devuelve cuántos productos cambiaron.
-- p_items = [{ "product_id": uuid, "counted": numeric }, ...]
create or replace function public.bulk_adjust_stock(p_items jsonb, p_note text default 'Conteo físico')
returns integer language plpgsql security definer set search_path = public as $$
declare v_changed integer;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  with counted as (
    select (i->>'product_id')::uuid as product_id, (i->>'counted')::numeric as counted
    from jsonb_array_elements(p_items) i
  ), diffs as (
    select p.id, c.counted - p.stock as diff
    from counted c join products p on p.id = c.product_id
    for update of p
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
