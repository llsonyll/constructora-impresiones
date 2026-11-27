-- Mover mercadería entre ubicaciones, sin tocar el stock. Dos usos:
--   · Reponer: bajar del depósito (D1) al estante lo que se acabó en la tienda. Antes había que editar a mano dos
--     cantidades (restar en D1 y sumar en el estante) y casi nunca se hacía, así las cantidades dejaban de servir.
--   · Ubicar una compra recibida: sumar lo que llegó a la ubicación donde se guardó, de toda la orden de una vez
--     (cada producto a su ubicación principal o todo al depósito), en vez de producto por producto.
-- El stock real (products.stock) no cambia: la mercadería ya está en el negocio, solo cambia de lugar. Las cantidades
-- por ubicación siguen siendo referenciales.
--
-- p = { "items": [{ "product_id": uuid, "to_location_id": bigint, "qty": numeric, "from_location_id"?: bigint }] }
--   Con from: se resta de esa ubicación (no más de lo anotado ahí; si no tenía cantidad anotada, no se toca) y se
--   suma a la de destino. Sin from: solo se suma al destino (mercadería que entró con una compra).
--   El destino se asigna al producto si no la tenía. Devuelve cuántas líneas se movieron.
create or replace function public.move_to_location(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_pid  uuid;
  v_to   bigint;
  v_from bigint;
  v_qty  numeric;
  v_have numeric;
  v_n    integer := 0;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  for v_item in select i from jsonb_array_elements(coalesce(p->'items', '[]')) i
                 order by i->>'product_id', i->>'to_location_id' loop
    v_pid  := (v_item->>'product_id')::uuid;
    v_to   := (v_item->>'to_location_id')::bigint;
    v_from := nullif(v_item->>'from_location_id', '')::bigint;
    v_qty  := (v_item->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad inválida para mover' using errcode = '22023';
    end if;
    if v_from = v_to then
      raise exception 'El origen y el destino son la misma ubicación' using errcode = '22023';
    end if;
    perform 1 from products where id = v_pid for update;
    if not found then raise exception 'El producto ya no existe'; end if;
    if not exists (select 1 from locations where id = v_to and active) then
      raise exception 'La ubicación de destino no existe o está desactivada';
    end if;

    if v_from is not null then
      select qty into v_have from product_locations where product_id = v_pid and location_id = v_from for update;
      if not found then raise exception 'El producto no está en la ubicación de origen'; end if;
      -- Más de lo anotado en el origen inflaría el destino: primero hay que contar el origen.
      if v_have is not null and v_qty > v_have then
        raise exception 'En % solo hay % anotados: cuenta esa ubicación o mueve menos',
          (select code from locations where id = v_from), trim_scale(v_have) using errcode = '22023';
      end if;
      update product_locations set qty = qty - v_qty
       where product_id = v_pid and location_id = v_from and qty is not null;
    end if;

    update product_locations set qty = coalesce(qty, 0) + v_qty where product_id = v_pid and location_id = v_to;
    if not found then
      insert into product_locations (product_id, location_id, qty) values (v_pid, v_to, v_qty);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.move_to_location(jsonb) from public, anon;
grant  execute on function public.move_to_location(jsonb) to authenticated;
