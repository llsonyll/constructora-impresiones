-- Las ventas de Firebase son todas de la app de impresiones → caja "Copias y librería".
-- (La migración de cajas se aplicó después de importarlas y quedaron con el valor por defecto, ferretería.)

update sales set caja = 'copias' where legacy_ref is not null and caja <> 'copias';

/**
 * Importa ventas de Firebase (arreglo como el "Descargar respaldo" de /index.html). Solo admin.
 * Devuelve { insertadas, omitidas } (omitidas = ya importadas antes).
 */
create or replace function public.import_legacy_sales(p_sales jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v        jsonb;
  i        jsonb;
  v_id     uuid;
  v_ins    int := 0;
  v_skip   int := 0;
  v_cashier uuid;
  v_sold   timestamptz;
  v_sku    text;
  v_pid    uuid;
  v_pname  text;
  v_desc   text;
  v_extra  text;
  v_qty    numeric;
  v_sub    numeric;
  v_total  numeric;
begin
  if not public.has_role('admin') then
    raise exception 'Solo un administrador puede importar ventas' using errcode = '42501';
  end if;

  for v in select * from jsonb_array_elements(p_sales) loop
    if exists (select 1 from sales where legacy_ref = v->>'id') then
      v_skip := v_skip + 1;
      continue;
    end if;

    select user_id into v_cashier from legacy_user_map where legacy_name = v->>'usuario';
    if v_cashier is null then
      raise exception 'El usuario "%" de Firebase no está asignado (legacy_user_map)', v->>'usuario';
    end if;

    -- El id de Firebase empieza con Date.now() en ms: hora exacta. Si no, fecha + hora local.
    v_sold := case when v->>'id' ~ '^\d{13}-'
                   then to_timestamp(left(v->>'id', 13)::bigint / 1000.0)
                   else ((v->>'fecha') || ' ' || coalesce(nullif(v->>'hora', ''), '12:00'))::timestamp at time zone 'America/Lima' end;
    v_id := md5('firebase:' || (v->>'id'))::uuid;

    insert into sales (id, cashier_id, shift, payment_method, total, status, note, sold_at, legacy_ref, caja)
    values (v_id, v_cashier,
            (case when public.legacy_norm(v->>'turno') = 'tarde' then 'tarde' else 'manana' end)::shift_type,
            (case public.legacy_norm(v->>'pago') when 'yape' then 'yape' when 'plin' then 'plin'
                  when 'tarjeta' then 'tarjeta' when 'transferencia' then 'transferencia' else 'efectivo' end)::payment_method,
            0, 'completada', 'Importada de Firebase (' || coalesce(v->>'usuario', '?') || ')', v_sold, v->>'id',
            'copias');

    v_total := 0;
    -- Ventas muy antiguas no tenían `items` (un solo producto con `monto`).
    for i in select * from jsonb_array_elements(coalesce(v->'items', jsonb_build_array(jsonb_build_object(
               'categoria', v->'categoria', 'subcategoria', v->'subcategoria', 'descripcion', v->'descripcion',
               'cantidad', coalesce(v->'cantidad', '1'::jsonb), 'precioUnitario', v->'monto', 'subtotal', v->'monto')))) loop
      v_qty   := coalesce(nullif(i->>'cantidad', '')::numeric, 1);
      v_sub   := coalesce(nullif(i->>'subtotal', '')::numeric, round(v_qty * (i->>'precioUnitario')::numeric, 2));
      v_extra := nullif(trim(coalesce(i->>'descripcion', '')), '');
      v_sku   := public.legacy_print_sku(i->>'categoria', i->>'subcategoria');
      v_pid := null; v_pname := null;
      if v_sku is not null then
        select id, name into v_pid, v_pname from products where sku = v_sku;
      end if;

      v_desc := case
        when v_sku = 'IMP-900' then coalesce(v_extra, (i->>'categoria') || ' personalizada')
        when v_pid is not null then v_pname || coalesce(' — ' || v_extra, '')
        when public.legacy_norm(i->>'subcategoria') in ('', 'personalizado') then coalesce(v_extra, 'Otros')
        else (i->>'subcategoria') || coalesce(' — ' || v_extra, '')
      end;

      insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, subtotal)
      values (v_id, v_pid, v_desc, v_qty, coalesce(nullif(i->>'precioUnitario', '')::numeric, v_sub / v_qty), null, v_sub);
      v_total := v_total + v_sub;
    end loop;

    update sales set total = round(v_total, 2) where id = v_id;
    v_ins := v_ins + 1;
  end loop;

  return jsonb_build_object('insertadas', v_ins, 'omitidas', v_skip);
end $$;

