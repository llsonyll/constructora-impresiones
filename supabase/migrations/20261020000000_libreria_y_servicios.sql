-- Caja "Copias y librería": catálogo de Librería y alta de servicios de copias desde Ventas.

-- 1) Servicios de copias/impresión creados desde el POS (admin y cajero).
--    El cajero no puede insertar en products (RLS); esta función solo crea SERVICIOS de la caja de copias
--    (sin stock, categoría Fotocopias o Impresiones), así no abre el alta general del catálogo.
create or replace function public.create_copy_service(p jsonb) returns products
language plpgsql security definer set search_path = public as $$
declare
  v_kind  text    := p->>'kind';                      -- fotocopia | impresion | otro
  v_name  text    := nullif(trim(p->>'name'), '');
  v_price numeric := nullif(p->>'price', '')::numeric;
  v_cat   bigint;
  v_sku   text;
  v_row   products;
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('fotocopia', 'impresion', 'otro') then
    raise exception 'Tipo de servicio inválido';
  end if;
  if v_name is null then raise exception 'El nombre es obligatorio'; end if;
  if v_price is null or v_price <= 0 then raise exception 'El precio debe ser mayor a 0'; end if;
  if exists (select 1 from products where lower(name) = lower(v_name)) then
    raise exception 'Ya existe un producto llamado "%"', v_name using errcode = '23505';
  end if;

  select id into v_cat from categories where name = case v_kind when 'fotocopia' then 'Fotocopias' else 'Impresiones' end;

  -- Siguiente IMP-0xx (IMP-900 en adelante queda para usos internos, p. ej. el histórico de Firebase).
  select 'IMP-' || lpad((coalesce(max(substring(sku from 5)::int), 0) + 1)::text, 3, '0') into v_sku
    from products where sku ~ '^IMP-\d{3}$' and substring(sku from 5)::int < 900;

  insert into products (sku, name, category_id, unit, price, active, track_stock,
                        job_sources, job_color, job_duplex, job_keywords, needs_review, notes)
  values (v_sku, v_name, v_cat, coalesce(nullif(p->>'unit', ''), 'hoja'), v_price, true, false,
          case v_kind when 'fotocopia' then array['konica-copia'] when 'impresion' then array['pc-print'] else '{}'::text[] end,
          case when v_kind = 'otro' then null else nullif(p->>'color', '')::boolean end,
          v_kind <> 'otro' and coalesce((p->>'duplex')::boolean, false),
          coalesce(array(select lower(trim(k)) from jsonb_array_elements_text(coalesce(p->'keywords', '[]'::jsonb)) k
                         where trim(k) <> ''), '{}'),
          false,
          'Creado desde Ventas por ' || coalesce((select nullif(full_name, '') from profiles where id = auth.uid()), 'usuario'))
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.create_copy_service(jsonb) from public, anon;
grant  execute on function public.create_copy_service(jsonb) to authenticated;

-- 2) "FOTOCOPIA COLOR" se creó con el alta rápida (única opción hasta ahora) como artículo de Librería con stock.
--    Es una fotocopia a color por hoja: pasa a servicio de Fotocopias, ofrecido en los trabajos color de la Konica.
update products
   set category_id = (select id from categories where name = 'Fotocopias'),
       track_stock = false, unit = 'hoja', job_sources = array['konica-copia'], job_color = true, job_duplex = false
 where sku = 'NUE-0046' and name = 'FOTOCOPIA COLOR' and track_stock;

-- 3) Catálogo inicial de Librería con lo que ya se vendía como ítem libre (precio = el cobrado habitualmente).
--    Llevan stock (empieza en 0) y quedan "por revisar" para cargar costo y stock real.
insert into products (sku, name, category_id, unit, price, active, track_stock, needs_review, notes)
select v.sku, v.name, (select id from categories where name = 'Librería'), v.unit, v.price, true, true, true,
       'Precio tomado de ventas anteriores (ítem libre). Completar costo y stock.'
  from (values
    ('LIB-001', 'FOLDER MANILA',            'und',  1.00),
    ('LIB-002', 'MICA',                     'und',  1.00),
    ('LIB-003', 'SOBRE MANILA',             'und',  1.00),
    ('LIB-004', 'LAPICERO',                 'und',  1.00),
    ('LIB-005', 'LAPICERO PILOT',           'und',  5.00),
    ('LIB-006', 'REGLA',                    'und',  1.00),
    ('LIB-007', 'REGLA DE PLÁSTICO',        'und',  2.00),
    ('LIB-008', 'PAPEL BOND (HOJA)',        'hoja', 0.10),
    ('LIB-009', 'TAMPÓN PARA HUELLA',       'und',  5.50),
    ('LIB-010', 'CORRECTOR',                'und',  3.50),
    ('LIB-011', 'CLIPS',                    'und',  2.50),
    ('LIB-012', 'FOLDER PLASTIFICADO',      'und',  6.00),
    ('LIB-013', 'FASTENER (FIERRITO PARA FOLDER)', 'und', 0.30)
  ) as v(sku, name, unit, price)
on conflict (sku) do nothing;
