-- Lo que se vende sale del estante, no del depósito. Hasta ahora la ubicación principal era la primera que se
-- asignaba: si un producto entró primero al depósito (D1) y después se puso en un estante, el D1 seguía siendo la
-- principal, Ventas mostraba "D1" y cada venta descontaba la cantidad del depósito en vez de la del estante.
--   1. Al agregar una ubicación de la tienda a un producto cuya principal es un depósito, la nueva pasa a ser la
--      principal (la que se ve en Ventas). Si se quita la principal, la reemplaza una de la tienda antes que un
--      depósito. Se puede seguir marcando un depósito como principal a mano.
--   2. Ventas, devoluciones y anulaciones mueven primero las cantidades de la tienda y después las del depósito,
--      sea cual sea la principal: lo que se lleva el cliente siempre sale del local.
-- Las cantidades por ubicación siguen siendo referenciales; el stock real no cambia con esto.

-- ---------- Ubicación principal ----------
create or replace function public.product_location_primary() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_primary then
      update product_locations set is_primary = true
       where (product_id, location_id) = (
         select pl.product_id, pl.location_id from product_locations pl join locations l on l.id = pl.location_id
          where pl.product_id = old.product_id
          order by (l.furniture_type = 'deposito'), pl.created_at, pl.location_id limit 1);
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' and not new.is_primary then
    -- Sin principal, o con la principal en un depósito y la nueva en la tienda: la nueva es la principal.
    if not exists (select 1 from product_locations where product_id = new.product_id and is_primary)
       or ((select furniture_type <> 'deposito' from locations where id = new.location_id) and exists (
             select 1 from product_locations pl join locations l on l.id = pl.location_id
              where pl.product_id = new.product_id and pl.is_primary and l.furniture_type = 'deposito')) then
      new.is_primary := true;
    end if;
  end if;
  if new.is_primary and (tg_op = 'INSERT' or not old.is_primary) then
    update product_locations set is_primary = false
     where product_id = new.product_id and location_id <> new.location_id and is_primary;
  end if;
  return new;
end $$;

-- ---------- Cantidades por ubicación al vender ----------
-- Lo que vuelve (anulación, devolución) se repone en la primera ubicación con cantidad; lo que sale (venta, anular
-- un cambio) se descuenta de una en una. En ambos casos: tienda antes que depósito, luego la principal y la más antigua.
create or replace function public.apply_location_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_left numeric := -new.qty;   -- unidades base por descontar
  v_loc  record;
  v_take numeric;
begin
  if new.qty > 0 then
    update product_locations set qty = greatest(qty + new.qty, 0)
     where (product_id, location_id) = (
       select pl.product_id, pl.location_id from product_locations pl join locations l on l.id = pl.location_id
        where pl.product_id = new.product_id and pl.qty is not null
        order by (l.furniture_type = 'deposito'), pl.is_primary desc, pl.created_at, pl.location_id limit 1);
    return null;
  end if;

  for v_loc in select pl.location_id, pl.qty from product_locations pl join locations l on l.id = pl.location_id
                where pl.product_id = new.product_id and pl.qty > 0
                order by (l.furniture_type = 'deposito'), pl.is_primary desc, pl.created_at, pl.location_id
                for update of pl loop
    exit when v_left <= 0;
    v_take := least(v_loc.qty, v_left);
    update product_locations set qty = qty - v_take
     where product_id = new.product_id and location_id = v_loc.location_id;
    v_left := v_left - v_take;
  end loop;
  return null;
end $$;
revoke execute on function public.apply_location_movement() from public, anon, authenticated;
