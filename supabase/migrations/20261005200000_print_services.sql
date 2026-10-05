-- Impresiones y fotocopias en el POS: productos de servicio (sin stock) y datos para
-- clasificar los trabajos que detecta el agente local (Konica por SNMP, PaperCut).
-- La lógica de clasificación vive en shared/print/core.js (compartida con /index.html).

-- Servicios: se venden pero no llevan stock (create_sale no genera movimientos para ellos).
alter table products add column track_stock boolean not null default true;

-- A qué trabajos del agente se ofrece cada producto.
alter table products add column job_sources  text[]  not null default '{}'
  check (job_sources <@ array['konica-copia', 'pc-print']::text[]);
alter table products add column job_color    boolean;                       -- null = B/N o color
alter table products add column job_duplex   boolean not null default false; -- se sugiere en trabajos doble cara
alter table products add column job_keywords text[]  not null default '{}';  -- se buscan en el nombre del documento

create index products_job_sources_idx on products using gin (job_sources) where job_sources <> '{}';

-- Stock bajo: los servicios no cuentan.
create or replace view low_stock_products with (security_invoker = true) as
  select id, sku, barcode, name, category_id, provider_id, unit, price, stock, min_stock, active, created_at, updated_at
    from products where active and track_stock and stock <= min_stock;

-- create_sale: igual que antes, salvo que los servicios no descuentan stock.
create or replace function public.create_sale(p_sale jsonb) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := (p_sale->>'id')::uuid;
  v_sale  sales;
  v_item  jsonb;
  v_total numeric(12,2) := 0;
  v_qty   numeric;
  v_price numeric;
  v_cost  numeric;
  v_track boolean;
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado para registrar ventas' using errcode = '42501';
  end if;

  select * into v_sale from sales where id = v_id;
  if found then return v_sale; end if;

  if jsonb_array_length(coalesce(p_sale->'items', '[]')) = 0 then
    raise exception 'La venta no tiene ítems';
  end if;

  insert into sales (id, cashier_id, shift, payment_method, total, customer_name,
                     customer_doc, note, sold_at)
  values (v_id, auth.uid(), (p_sale->>'shift')::shift_type,
          (p_sale->>'payment_method')::payment_method, 0,
          nullif(p_sale->>'customer_name',''), nullif(p_sale->>'customer_doc',''),
          nullif(p_sale->>'note',''), coalesce((p_sale->>'sold_at')::timestamptz, now()))
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_sale->'items') loop
    v_qty   := (v_item->>'qty')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_cost  := null;
    v_track := false;
    if v_item->>'product_id' is not null then
      select cost into v_cost from product_costs where product_id = (v_item->>'product_id')::uuid;
      select track_stock into v_track from products where id = (v_item->>'product_id')::uuid;
    end if;

    insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, subtotal)
    values (v_id, nullif(v_item->>'product_id','')::uuid, v_item->>'description',
            v_qty, v_price, v_cost, round(v_qty * v_price, 2));

    if coalesce(v_track, false) then
      insert into stock_movements (product_id, qty, reason, sale_id)
      values ((v_item->>'product_id')::uuid, -v_qty, 'venta', v_id);
    end if;

    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  update sales set total = v_total where id = v_id returning * into v_sale;
  return v_sale;
end $$;

-- void_sale: repone solo lo que se descontó (los servicios no tienen movimientos).
create or replace function public.void_sale(p_sale_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin') then
    raise exception 'Solo un administrador puede anular ventas' using errcode = '42501';
  end if;
  update sales set status = 'anulada', voided_at = now(), voided_by = auth.uid()
   where id = p_sale_id and status = 'completada';
  if not found then return; end if;
  insert into stock_movements (product_id, qty, reason, sale_id)
  select m.product_id, -m.qty, 'anulacion_venta', p_sale_id
    from stock_movements m where m.sale_id = p_sale_id and m.reason = 'venta';
end $$;

-- Catálogo de impresión y fotocopia (mismos precios que la app de impresiones en Firebase).
-- Precio por hoja; se puede cambiar en Inventario. No pisa productos ya creados con ese SKU.
insert into products (sku, name, category_id, unit, price, active, track_stock,
                      job_sources, job_color, job_duplex, job_keywords)
select v.sku, v.name, (select id from categories where name = 'Impresión y fotocopia'),
       v.unit, v.price, true, false, v.sources, v.color, v.duplex, v.keywords
  from (values
    ('IMP-001', 'Fotocopia B/N',                  'hoja', 0.20, array['konica-copia'], false, false, '{}'::text[]),
    ('IMP-002', 'Fotocopia B/N doble cara',       'hoja', 0.30, array['konica-copia'], false, true,  '{}'),
    ('IMP-003', 'Fotocopia DNI B/N',              'hoja', 0.50, array['konica-copia'], false, false, '{}'),
    ('IMP-004', 'Fotocopia DNI color',            'hoja', 1.00, array['konica-copia'], true,  false, '{}'),
    ('IMP-005', 'Fotocopia DNI ampliado B/N',     'hoja', 0.80, array['konica-copia'], false, false, '{}'),
    ('IMP-006', 'Fotocopia DNI ampliado color',   'hoja', 1.50, array['konica-copia'], true,  false, '{}'),
    ('IMP-007', 'Impresión B/N',                  'hoja', 0.50, array['pc-print'],     false, false, '{}'),
    ('IMP-008', 'Impresión B/N doble cara',       'hoja', 0.50, array['pc-print'],     false, true,  '{}'),
    ('IMP-009', 'Impresión color',                'hoja', 0.50, array['pc-print'],     true,  false, '{}'),
    ('IMP-010', 'Impresión color (grande)',       'hoja', 1.00, array['pc-print'],     true,  false, '{}'),
    ('IMP-011', 'Impresión récord de conductor',  'hoja', 1.00, array['pc-print'],     null,  false, array['record', 'conductor']),
    ('IMP-012', 'Impresión DNI ampliado B/N',     'hoja', 1.00, array['pc-print'],     false, false, array['dni']),
    ('IMP-013', 'Impresión DNI ampliado color',   'hoja', 1.50, array['pc-print'],     true,  false, array['dni']),
    ('IMP-014', 'Escaneo',                        'und',  1.00, array[]::text[],       null,  false, '{}')
  ) as v(sku, name, unit, price, sources, color, duplex, keywords)
on conflict (sku) do nothing;
