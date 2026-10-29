-- La cantidad por ubicación (product_locations.qty) también se mueve con las ventas: hasta ahora solo bajaba
-- products.stock y la ubicación seguía mostrando lo que se contó (p. ej. 70 en E3-N3 con stock 55).
-- Sigue siendo referencial: solo se toca donde hay cantidad anotada (null = no contada) y nunca baja de 0.
-- Venta: descuenta primero de la principal y el resto de las otras, de la más antigua a la más nueva.
-- Anulación: repone en la primera ubicación con cantidad, en el mismo orden (la principal si la tiene).
-- Compras y ajustes no tocan las ubicaciones: lo recibido no está necesariamente en el estante.

create or replace function public.apply_location_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_left numeric := -new.qty;   -- unidades base vendidas por descontar
  v_loc  record;
  v_take numeric;
begin
  if new.reason = 'anulacion_venta' then
    update product_locations set qty = greatest(qty + new.qty, 0)
     where (product_id, location_id) = (
       select product_id, location_id from product_locations
        where product_id = new.product_id and qty is not null
        order by is_primary desc, created_at, location_id limit 1);
    return null;
  end if;

  for v_loc in select location_id, qty from product_locations
                where product_id = new.product_id and qty > 0
                order by is_primary desc, created_at, location_id
                for update loop
    exit when v_left <= 0;
    v_take := least(v_loc.qty, v_left);
    update product_locations set qty = qty - v_take
     where product_id = new.product_id and location_id = v_loc.location_id;
    v_left := v_left - v_take;
  end loop;
  return null;
end $$;

create trigger stock_movements_locations after insert on stock_movements
  for each row when (new.reason in ('venta', 'anulacion_venta')) execute function apply_location_movement();

-- Solo lo usa el trigger; nadie lo llama desde la API.
revoke execute on function public.apply_location_movement() from public, anon, authenticated;
