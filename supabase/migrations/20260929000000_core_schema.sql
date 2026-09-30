-- =====================================================================
-- La Constructora — esquema núcleo (Ventas, Inventario, Proveedores, Documentos)
-- Roles: admin, cajero, almacen
-- Stock: products.stock es un cache mantenido por trigger desde stock_movements
--        (el libro de movimientos es la fuente de verdad).
-- Ventas: se crean solo vía RPC create_sale() (idempotente por id de cliente,
--        pensado para sincronización offline).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
create type user_role       as enum ('admin', 'cajero', 'almacen');
create type payment_method  as enum ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia');
create type sale_status     as enum ('completada', 'anulada');
create type shift_type      as enum ('manana', 'tarde');
create type movement_reason as enum ('venta', 'compra', 'ajuste', 'devolucion', 'anulacion_venta');
create type po_status       as enum ('borrador', 'enviada', 'recibida', 'cancelada');
create type document_type   as enum ('cotizacion', 'boleta', 'factura', 'nota_venta');
create type sunat_status    as enum ('no_aplica', 'pendiente', 'aceptado', 'rechazado', 'anulado');

-- ---------- Utilidades ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- Perfiles / roles ----------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       user_role not null default 'cajero',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Rol del usuario actual. SECURITY DEFINER para evitar recursión de RLS en profiles.
create or replace function public.current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles user_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() = any(roles), false)
$$;

-- Al registrarse un usuario se crea su perfil con rol mínimo (cajero, activo=false
-- hasta que un admin lo apruebe: evita que cualquiera con la anon key opere).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email, ''), false);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Catálogo ----------
create table categories (
  id   bigint generated always as identity primary key,
  name text not null unique
);

create table providers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  ruc        text unique check (ruc is null or ruc ~ '^\d{11}$'),
  contact    text,
  phone      text,
  email      text,
  address    text,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger providers_updated before update on providers
  for each row execute function set_updated_at();

create table products (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null unique,
  barcode     text unique,
  name        text not null,
  category_id bigint references categories(id) on delete set null,
  provider_id uuid   references providers(id)  on delete set null,
  unit        text not null default 'und',            -- und, m, kg, bolsa, ...
  price       numeric(12,2) not null check (price >= 0),  -- precio de venta, IGV incluido (se desglosa en el comprobante)
  stock       numeric(12,3) not null default 0,       -- cache; puede ser negativo (ventas antes de cargar stock)
  min_stock   numeric(12,3) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_name_idx     on products using gin (to_tsvector('spanish', name));
create index products_category_idx on products (category_id);
create index products_provider_idx on products (provider_id);
create trigger products_updated before update on products
  for each row execute function set_updated_at();

-- El costo vive aparte para que el cajero no pueda leerlo (RLS es por fila, no por columna).
create table product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  cost       numeric(12,2) not null default 0 check (cost >= 0),
  updated_at timestamptz not null default now()
);

-- ---------- Libro de movimientos de stock ----------
create table stock_movements (
  id         bigint generated always as identity primary key,
  product_id uuid not null references products(id),
  qty        numeric(12,3) not null check (qty <> 0),   -- + entra, - sale
  reason     movement_reason not null,
  sale_id    uuid,             -- FK se agrega abajo
  po_id      uuid,             -- FK se agrega abajo
  note       text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_movements_product_idx on stock_movements (product_id, created_at desc);

create or replace function apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update products set stock = stock + new.qty where id = new.product_id;
  return new;
end $$;
create trigger stock_movements_apply after insert on stock_movements
  for each row execute function apply_stock_movement();

-- ---------- Ventas ----------
create sequence sale_number_seq;

create table sales (
  id             uuid primary key,                      -- generado por el cliente (idempotencia offline)
  number         bigint not null unique default nextval('sale_number_seq'),
  cashier_id     uuid not null references auth.users(id),
  shift          shift_type not null,
  payment_method payment_method not null,
  total          numeric(12,2) not null check (total >= 0),
  status         sale_status not null default 'completada',
  customer_name  text,
  customer_doc   text,                                  -- DNI/RUC opcional
  note           text,
  sold_at        timestamptz not null,                  -- hora real de la venta (cliente)
  created_at     timestamptz not null default now(),    -- hora de sincronización
  voided_at      timestamptz,
  voided_by      uuid references auth.users(id)
);
create index sales_sold_at_idx on sales (sold_at desc);
create index sales_cashier_idx on sales (cashier_id, sold_at desc);

create table sale_items (
  id           bigint generated always as identity primary key,
  sale_id      uuid not null references sales(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,   -- null = ítem libre (impresión, etc.)
  description  text not null,
  qty          numeric(12,3) not null check (qty > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  unit_cost    numeric(12,2),                            -- snapshot del costo (para margen)
  subtotal     numeric(12,2) not null
);
create index sale_items_sale_idx    on sale_items (sale_id);
create index sale_items_product_idx on sale_items (product_id);

alter table stock_movements add constraint stock_movements_sale_fk foreign key (sale_id) references sales(id);

-- ---------- Compras a proveedores ----------
create table purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id),
  status      po_status not null default 'borrador',
  ordered_at  timestamptz,
  received_at timestamptz,
  total       numeric(12,2) not null default 0,
  note        text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger purchase_orders_updated before update on purchase_orders
  for each row execute function set_updated_at();

create table purchase_order_items (
  id         bigint generated always as identity primary key,
  po_id      uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  qty        numeric(12,3) not null check (qty > 0),
  unit_cost  numeric(12,2) not null check (unit_cost >= 0),
  subtotal   numeric(12,2) generated always as (round(qty * unit_cost, 2)) stored
);
create index po_items_po_idx on purchase_order_items (po_id);

alter table stock_movements add constraint stock_movements_po_fk foreign key (po_id) references purchase_orders(id);

-- ---------- Documentos ----------
create table documents (
  id            uuid primary key default gen_random_uuid(),
  type          document_type not null,
  series        text,                       -- p.ej. B001, F001, COT
  number        bigint,
  sale_id       uuid references sales(id) on delete set null,
  customer_name text,
  customer_doc  text,
  total         numeric(12,2),
  payload       jsonb not null default '{}', -- ítems/condiciones (cotizaciones)
  file_path     text,                        -- Supabase Storage: bucket "documents"
  sunat_status  sunat_status not null default 'no_aplica',
  external_id   text,                        -- id en el OSE/PSE (Nubefact/Efact)
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (type, series, number)
);
create index documents_sale_idx on documents (sale_id);

-- ---------- RPC: crear venta (idempotente) ----------
-- p_sale = {
--   "id": uuid, "shift": "manana|tarde", "payment_method": "...", "sold_at": iso,
--   "customer_name": .., "customer_doc": .., "note": ..,
--   "items": [{ "product_id": uuid|null, "description": "..", "qty": n, "unit_price": n }]
-- }
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
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado para registrar ventas' using errcode = '42501';
  end if;

  -- Idempotencia: si ya se sincronizó, devolver la existente.
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
    if v_item->>'product_id' is not null then
      select cost into v_cost from product_costs where product_id = (v_item->>'product_id')::uuid;
    end if;

    insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, subtotal)
    values (v_id, nullif(v_item->>'product_id','')::uuid, v_item->>'description',
            v_qty, v_price, v_cost, round(v_qty * v_price, 2));

    if v_item->>'product_id' is not null then
      insert into stock_movements (product_id, qty, reason, sale_id)
      values ((v_item->>'product_id')::uuid, -v_qty, 'venta', v_id);
    end if;

    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  update sales set total = v_total where id = v_id returning * into v_sale;
  return v_sale;
end $$;

-- ---------- RPC: anular venta (repone stock) ----------
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
  select product_id, qty, 'anulacion_venta', p_sale_id
    from sale_items where sale_id = p_sale_id and product_id is not null;
end $$;

-- ---------- RPC: recibir orden de compra (entra stock y actualiza costo) ----------
create or replace function public.receive_purchase_order(p_po_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update purchase_orders set status = 'recibida', received_at = now()
   where id = p_po_id and status in ('borrador', 'enviada');
  if not found then raise exception 'La orden no existe o ya fue procesada'; end if;

  insert into stock_movements (product_id, qty, reason, po_id)
  select product_id, qty, 'compra', p_po_id from purchase_order_items where po_id = p_po_id;

  insert into product_costs (product_id, cost)
  select product_id, unit_cost from purchase_order_items where po_id = p_po_id
  on conflict (product_id) do update set cost = excluded.cost, updated_at = now();

  update purchase_orders set total =
    (select coalesce(sum(subtotal), 0) from purchase_order_items where po_id = p_po_id)
   where id = p_po_id;
end $$;

-- ---------- RPC: ajuste manual de stock ----------
create or replace function public.adjust_stock(p_product_id uuid, p_new_stock numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_diff numeric;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select p_new_stock - stock into v_diff from products where id = p_product_id for update;
  if v_diff is null or v_diff = 0 then return; end if;
  insert into stock_movements (product_id, qty, reason, note)
  values (p_product_id, v_diff, 'ajuste', p_note);
end $$;

-- ---------- Vista: productos con stock bajo ----------
create view low_stock_products with (security_invoker = true) as
  select * from products where active and stock <= min_stock;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table profiles              enable row level security;
alter table categories            enable row level security;
alter table providers             enable row level security;
alter table products              enable row level security;
alter table product_costs         enable row level security;
alter table stock_movements       enable row level security;
alter table sales                 enable row level security;
alter table sale_items            enable row level security;
alter table purchase_orders       enable row level security;
alter table purchase_order_items  enable row level security;
alter table documents             enable row level security;

-- profiles: cada quien ve el suyo; admin ve y edita todos.
create policy profiles_self_read  on profiles for select using (id = auth.uid() or public.has_role('admin'));
create policy profiles_admin_all  on profiles for all    using (public.has_role('admin')) with check (public.has_role('admin'));

-- categories / products: todos los roles activos leen; admin y almacén escriben.
create policy categories_read  on categories for select using (public.has_role('admin','cajero','almacen'));
create policy categories_write on categories for all    using (public.has_role('admin','almacen')) with check (public.has_role('admin','almacen'));

create policy products_read  on products for select using (public.has_role('admin','cajero','almacen'));
create policy products_write on products for all    using (public.has_role('admin','almacen')) with check (public.has_role('admin','almacen'));

-- costos: solo admin y almacén.
create policy costs_all on product_costs for all
  using (public.has_role('admin','almacen')) with check (public.has_role('admin','almacen'));

-- proveedores y compras: admin y almacén (cajero no).
create policy providers_all on providers for all
  using (public.has_role('admin','almacen')) with check (public.has_role('admin','almacen'));
create policy po_all on purchase_orders for all
  using (public.has_role('admin','almacen')) with check (public.has_role('admin','almacen'));
create policy po_items_all on purchase_order_items for all
  using (public.has_role('admin','almacen')) with check (public.has_role('admin','almacen'));

-- movimientos de stock: lectura admin/almacén; escritura solo por RPC/trigger (SECURITY DEFINER).
create policy stock_mov_read on stock_movements for select using (public.has_role('admin','almacen'));

-- ventas: cajero ve solo las suyas; admin todas; almacén ninguna. Sin INSERT/UPDATE directo (usar RPC).
create policy sales_read on sales for select
  using (public.has_role('admin') or (public.has_role('cajero') and cashier_id = auth.uid()));
create policy sale_items_read on sale_items for select
  using (exists (select 1 from sales s where s.id = sale_id
                 and (public.has_role('admin') or (public.has_role('cajero') and s.cashier_id = auth.uid()))));

-- documentos: admin todo; cajero crea/lee los suyos.
create policy documents_admin on documents for all
  using (public.has_role('admin')) with check (public.has_role('admin'));
create policy documents_cajero_read on documents for select
  using (public.has_role('cajero') and created_by = auth.uid());
create policy documents_cajero_insert on documents for insert
  with check (public.has_role('cajero') and created_by = auth.uid());

-- NOTA: sale_items.unit_cost (snapshot de costo) es legible por el cajero para sus propias
-- ventas. Si se quiere ocultar, pasar a una tabla aparte solo-admin (como product_costs).

-- Permisos de RPC: solo usuarios autenticados.
revoke execute on function public.create_sale(jsonb)               from public, anon;
revoke execute on function public.void_sale(uuid)                  from public, anon;
revoke execute on function public.receive_purchase_order(uuid)     from public, anon;
revoke execute on function public.adjust_stock(uuid, numeric, text) from public, anon;
grant  execute on function public.create_sale(jsonb)               to authenticated;
grant  execute on function public.void_sale(uuid)                  to authenticated;
grant  execute on function public.receive_purchase_order(uuid)     to authenticated;
grant  execute on function public.adjust_stock(uuid, numeric, text) to authenticated;

-- Realtime: stock y ventas en vivo.
alter publication supabase_realtime add table products, sales;
