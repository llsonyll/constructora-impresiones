-- Faltantes: productos que se necesitan y todavía no se consiguieron. Antes se perdían en papeles sueltos
-- (líneas que un proveedor no atendió, lo que pidió un cliente y no había, productos que no están en el catálogo).
--   pendiente  → hay que conseguirlo. Puede estar enlazado a una orden de compra abierta (po_id): "pedido".
--   atendido   → llegó: se cierra solo al recibir una orden que trae ese producto, o a mano.
--   descartado → ya no hace falta.
-- Un faltante puede ser un producto del catálogo (product_id) o solo una descripción ("Acople 7/8 a 1/2");
-- para pedirlo en una orden primero se registra el producto.

create table product_needs (
  id           bigint generated always as identity primary key,
  product_id   uuid references products(id) on delete set null,
  description  text not null check (length(trim(description)) > 0),   -- lo que se pidió, tal cual
  qty          numeric(12,3) check (qty is null or qty > 0),
  unit         text,                                                   -- und, cajas, paquetes… (la del pedido)
  source       text not null default 'manual'
               check (source in ('pedido', 'cliente', 'stock_bajo', 'manual')),
  provider_id  uuid references providers(id) on delete set null,      -- quién no lo atendió / a quién pedirlo
  reference    text,                                                   -- p. ej. "NV 0001-000234"
  notes        text,
  status       text not null default 'pendiente' check (status in ('pendiente', 'atendido', 'descartado')),
  po_id        uuid references purchase_orders(id) on delete set null, -- orden en que se pidió (o con la que llegó)
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id) on delete set null
);
create index product_needs_status_idx   on product_needs (status, created_at desc);
create index product_needs_product_idx  on product_needs (product_id);
create index product_needs_provider_idx on product_needs (provider_id);
create index product_needs_po_idx       on product_needs (po_id);
create index product_needs_created_by_idx  on product_needs (created_by);
create index product_needs_resolved_by_idx on product_needs (resolved_by);

create trigger product_needs_updated before update on product_needs
  for each row execute function set_updated_at();

-- Cerrar o reabrir deja constancia de cuándo y quién.
create or replace function public.product_needs_resolve() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'pendiente' then
      new.resolved_at := null; new.resolved_by := null;
    else
      new.resolved_at := coalesce(new.resolved_at, now()); new.resolved_by := coalesce(new.resolved_by, auth.uid());
    end if;
  end if;
  return new;
end $$;
create trigger product_needs_resolve before update of status on product_needs
  for each row execute function product_needs_resolve();

alter table product_needs enable row level security;
-- Como proveedores y compras: admin y almacén.
create policy product_needs_read on product_needs for select to authenticated
  using ((select public.has_role('admin', 'almacen')));
create policy product_needs_insert on product_needs for insert to authenticated
  with check ((select public.has_role('admin', 'almacen')));
create policy product_needs_update on product_needs for update to authenticated
  using ((select public.has_role('admin', 'almacen'))) with check ((select public.has_role('admin', 'almacen')));
create policy product_needs_delete on product_needs for delete to authenticated
  using ((select public.has_role('admin', 'almacen')));

-- ---------- Enlace con las órdenes de compra ----------
-- Recibida: se atienden los faltantes pendientes de los productos que trae (estén o no enlazados a ella) y se
-- sueltan los enlazados a ella cuyo producto se quitó de la orden. Cancelada: se sueltan (vuelven a "pendiente" sin orden).
create or replace function public.product_needs_on_po() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'recibida' then
    update product_needs n set status = 'atendido', po_id = new.id, resolved_at = now(), resolved_by = auth.uid()
     where n.status = 'pendiente'
       and n.product_id in (select product_id from purchase_order_items where po_id = new.id);
    update product_needs set po_id = null where status = 'pendiente' and po_id = new.id;
  elsif new.status = 'cancelada' then
    update product_needs set po_id = null where status = 'pendiente' and po_id = new.id;
  end if;
  return null;
end $$;
create trigger purchase_orders_needs after update of status on purchase_orders
  for each row execute function product_needs_on_po();

-- ---------- Actividad ----------
alter table activity_log drop constraint activity_log_kind_check;
alter table activity_log add constraint activity_log_kind_check
  check (kind in ('venta', 'producto', 'compra', 'stock', 'faltante'));

create or replace function public.log_need_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_label text;
  v_po    text;
begin
  begin
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
    v_label := new.description || coalesce(' · ' || trim(to_char(new.qty, 'FM999999990.###')) || coalesce(' ' || new.unit, ''), '');
    if tg_op = 'INSERT' then
      perform log_activity('faltante', 'faltante_registrado', new.id::text,
        format('Faltante registrado: %s%s', v_label,
               coalesce(' · ' || (select name from providers where id = new.provider_id), '')),
        jsonb_build_object('source', new.source, 'reference', new.reference, 'product_id', new.product_id));
    else
      select 'OC-' || lpad(number::text, 4, '0') into v_po from purchase_orders where id = new.po_id;
      perform log_activity('faltante', 'faltante_' || new.status, new.id::text,
        format('%s: %s%s',
               case new.status when 'atendido' then 'Faltante atendido'
                               when 'descartado' then 'Faltante descartado'
                               else 'Faltante reabierto' end,
               v_label, case when new.status = 'atendido' then coalesce(' · ' || v_po, '') else '' end),
        jsonb_build_object('antes', old.status, 'status', new.status, 'po_id', new.po_id));
    end if;
    return null;
  exception when others then
    raise warning 'activity_log (log_need_change): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
create trigger product_needs_activity after insert or update of status on product_needs
  for each row execute function log_need_change();

-- Funciones de trigger: solo las llama la base, no la API.
revoke execute on function public.product_needs_on_po()   from public, anon, authenticated;
revoke execute on function public.log_need_change()       from public, anon, authenticated;
revoke execute on function public.product_needs_resolve() from public, anon, authenticated;
