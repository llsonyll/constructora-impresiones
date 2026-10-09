-- Importación del historial de la app de impresiones (/index.html, Firebase → colección `trabajos`).
-- Repetible: cada venta guarda su id de Firebase en sales.legacy_ref y no se vuelve a insertar.
-- Las impresiones/fotocopias del catálogo antiguo se enlazan a los servicios IMP-0xx (cuentan como
-- "Impresiones y fotocopias" en Hoy/Reportes); los ítems "Personalizado" de impresión o fotocopia van a
-- IMP-900; "Otros" (folder, mica, varios) quedan como ítems libres. No generan movimientos de stock.

alter table sales add column legacy_ref text unique;   -- id del documento en Firebase

-- Quién registró la venta en la app antigua ("Yo", "Hermano") → usuario de Supabase.
create table legacy_user_map (
  legacy_name text primary key,
  user_id     uuid not null references auth.users(id)
);
alter table legacy_user_map enable row level security;
create policy legacy_user_map_read on legacy_user_map for select to authenticated
  using ((select public.has_role('admin')));

insert into legacy_user_map (legacy_name, user_id)
select v.name, u.id from (values ('Yo', 'sony_s07@hotmail.es'), ('Hermano', 'crobatone1@gmail.com')) v(name, email)
  join auth.users u on lower(u.email) = v.email
on conflict (legacy_name) do update set user_id = excluded.user_id;

-- Servicio genérico para impresiones/fotocopias "Personalizado" (no se vende desde el POS).
insert into products (sku, name, category_id, unit, price, active, track_stock)
values ('IMP-900', 'Impresión / fotocopia (varios)', (select id from categories where name = 'Impresión y fotocopia'),
        'und', null, false, false)
on conflict (sku) do nothing;

create or replace function public.legacy_norm(s text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(trim(coalesce(s, ''))), 'áéíóúñ', 'aeioun')
$$;

/** SKU del servicio que corresponde a un producto del catálogo antiguo (null = ítem libre). */
create or replace function public.legacy_print_sku(p_categoria text, p_subcategoria text) returns text
language sql immutable set search_path = public as $$
  select case public.legacy_norm(p_categoria) || '|' || public.legacy_norm(p_subcategoria)
    when 'fotocopia|simple'             then 'IMP-001'
    when 'fotocopia|duplex'             then 'IMP-002'
    when 'fotocopia|dni simple'         then 'IMP-003'
    when 'fotocopia|dni color'          then 'IMP-004'
    when 'fotocopia|dni ampliado b/n'   then 'IMP-005'
    when 'fotocopia|dni ampliado color' then 'IMP-006'
    when 'impresion|simple - b/n'       then 'IMP-007'
    when 'impresion|doble cara'         then 'IMP-008'
    when 'impresion|color'              then 'IMP-009'
    when 'impresion|color(grande)'      then 'IMP-010'
    when 'impresion|record conductor'   then 'IMP-011'
    when 'impresion|dni ampliado'       then 'IMP-012'
    when 'impresion|dni ampliado color' then 'IMP-013'
    when 'impresion|escaneo'            then 'IMP-014'
    else case when public.legacy_norm(p_categoria) in ('impresion', 'fotocopia') then 'IMP-900' end
  end
$$;

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

    insert into sales (id, cashier_id, shift, payment_method, total, status, note, sold_at, legacy_ref)
    values (v_id, v_cashier,
            (case when public.legacy_norm(v->>'turno') = 'tarde' then 'tarde' else 'manana' end)::shift_type,
            (case public.legacy_norm(v->>'pago') when 'yape' then 'yape' when 'plin' then 'plin'
                  when 'tarjeta' then 'tarjeta' when 'transferencia' then 'transferencia' else 'efectivo' end)::payment_method,
            0, 'completada', 'Importada de Firebase (' || coalesce(v->>'usuario', '?') || ')', v_sold, v->>'id');

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

revoke execute on function public.import_legacy_sales(jsonb) from public, anon;
grant  execute on function public.import_legacy_sales(jsonb) to authenticated;
revoke execute on function public.legacy_print_sku(text, text) from public, anon;
revoke execute on function public.legacy_norm(text) from public, anon;
