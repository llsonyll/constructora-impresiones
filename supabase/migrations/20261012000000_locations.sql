-- Ubicaciones físicas de la tienda: en qué mueble, cuerpo, nivel y sección está cada producto.
-- Código: MUEBLE[-CUERPO]-NIVEL[-SECCIÓN], p. ej. E2-N5, E4-N3-B, E0-B-N2-F. Nivel contado de arriba hacia abajo
-- (N1 = la repisa más alta); sección de izquierda a derecha. Las partes se guardan por separado (para un plano
-- interactivo más adelante) y el código se calcula a partir de ellas, así nunca se contradicen.

create type furniture_type as enum ('estante', 'vitrina', 'mostrador');

create table locations (
  id             bigint generated always as identity primary key,
  furniture      text not null check (furniture ~ '^[A-Z]\d+$'),     -- E0, E1… (futuro: V1 vitrina, M1 mostrador)
  body           text check (body ~ '^[A-Z]$'),                      -- cuerpo de un mueble compuesto (E0-A, E0-B…)
  level          int  not null check (level between 1 and 99),       -- N1 = arriba
  slot           text check (slot ~ '^[A-Z]$'),                      -- sección dentro del nivel, de izquierda a derecha
  code           text generated always as (
                   furniture || coalesce('-' || body, '') || '-N' || level::text || coalesce('-' || slot, '')
                 ) stored unique check (code ~ '^[A-Z]\d+(-[A-Z])?-N\d+(-[A-Z])?$'),
  furniture_type furniture_type not null default 'estante',
  description    text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index locations_furniture_idx on locations (furniture, body, level, slot);
create trigger locations_updated_at before update on locations
  for each row execute function set_updated_at();

-- Producto ↔ ubicación (varios a varios). qty es solo referencial: el stock real sale de stock_movements.
create table product_locations (
  product_id  uuid   not null references products(id) on delete cascade,
  location_id bigint not null references locations(id) on delete restrict,   -- con productos no se borra: se desactiva
  is_primary  boolean not null default false,
  qty         numeric(12,3) check (qty is null or qty >= 0),
  created_at  timestamptz not null default now(),
  primary key (product_id, location_id)
);
create unique index product_locations_one_primary on product_locations (product_id) where is_primary;
create index product_locations_location_idx on product_locations (location_id);

-- Siempre hay una principal si el producto tiene ubicaciones: la primera que se asigna lo es, marcar otra
-- desmarca la anterior y al quitar la principal pasa a serlo la más antigua de las que quedan.
create or replace function public.product_location_primary() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_primary then
      update product_locations set is_primary = true
       where (product_id, location_id) = (
         select product_id, location_id from product_locations
          where product_id = old.product_id order by created_at, location_id limit 1);
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' and not new.is_primary
     and not exists (select 1 from product_locations where product_id = new.product_id and is_primary) then
    new.is_primary := true;
  end if;
  if new.is_primary and (tg_op = 'INSERT' or not old.is_primary) then
    update product_locations set is_primary = false
     where product_id = new.product_id and location_id <> new.location_id and is_primary;
  end if;
  return new;
end $$;
create trigger product_locations_primary before insert or update of is_primary on product_locations
  for each row execute function product_location_primary();
create trigger product_locations_primary_del after delete on product_locations
  for each row execute function product_location_primary();

-- Todos los roles ven las ubicaciones (el cajero las ve en el POS); admin y almacén las administran.
alter table locations         enable row level security;
alter table product_locations enable row level security;
create policy locations_read   on locations for select to authenticated using ((select public.has_role('admin', 'cajero', 'almacen')));
create policy locations_insert on locations for insert to authenticated with check ((select public.has_role('admin', 'almacen')));
create policy locations_update on locations for update to authenticated
  using ((select public.has_role('admin', 'almacen'))) with check ((select public.has_role('admin', 'almacen')));
create policy locations_delete on locations for delete to authenticated using ((select public.has_role('admin', 'almacen')));
create policy product_locations_read   on product_locations for select to authenticated using ((select public.has_role('admin', 'cajero', 'almacen')));
create policy product_locations_insert on product_locations for insert to authenticated with check ((select public.has_role('admin', 'almacen')));
create policy product_locations_update on product_locations for update to authenticated
  using ((select public.has_role('admin', 'almacen'))) with check ((select public.has_role('admin', 'almacen')));
create policy product_locations_delete on product_locations for delete to authenticated using ((select public.has_role('admin', 'almacen')));

-- Estantes E0–E5 (106 ubicaciones).
insert into locations (furniture, body, level, slot) values
  ('E0', 'A', 1, null),
  ('E0', 'A', 2, null),
  ('E0', 'A', 3, null),
  ('E0', 'B', 1, 'A'),
  ('E0', 'B', 1, 'B'),
  ('E0', 'B', 1, 'C'),
  ('E0', 'B', 1, 'D'),
  ('E0', 'B', 1, 'E'),
  ('E0', 'B', 1, 'F'),
  ('E0', 'B', 1, 'G'),
  ('E0', 'B', 1, 'H'),
  ('E0', 'B', 2, 'A'),
  ('E0', 'B', 2, 'B'),
  ('E0', 'B', 2, 'C'),
  ('E0', 'B', 2, 'D'),
  ('E0', 'B', 2, 'E'),
  ('E0', 'B', 2, 'F'),
  ('E0', 'B', 2, 'G'),
  ('E0', 'B', 2, 'H'),
  ('E0', 'B', 3, 'A'),
  ('E0', 'B', 3, 'B'),
  ('E0', 'B', 3, 'C'),
  ('E0', 'B', 3, 'D'),
  ('E0', 'B', 3, 'E'),
  ('E0', 'B', 3, 'F'),
  ('E0', 'B', 3, 'G'),
  ('E0', 'B', 3, 'H'),
  ('E0', 'B', 4, 'A'),
  ('E0', 'B', 4, 'B'),
  ('E0', 'B', 4, 'C'),
  ('E0', 'B', 4, 'D'),
  ('E0', 'B', 4, 'E'),
  ('E0', 'B', 4, 'F'),
  ('E0', 'B', 4, 'G'),
  ('E0', 'B', 4, 'H'),
  ('E0', 'B', 5, 'A'),
  ('E0', 'B', 5, 'B'),
  ('E0', 'B', 5, 'C'),
  ('E0', 'B', 5, 'D'),
  ('E0', 'B', 5, 'E'),
  ('E0', 'B', 5, 'F'),
  ('E0', 'B', 5, 'G'),
  ('E0', 'B', 5, 'H'),
  ('E0', 'B', 6, 'A'),
  ('E0', 'B', 6, 'B'),
  ('E0', 'B', 6, 'C'),
  ('E0', 'B', 6, 'D'),
  ('E0', 'B', 6, 'E'),
  ('E0', 'B', 6, 'F'),
  ('E0', 'B', 6, 'G'),
  ('E0', 'B', 6, 'H'),
  ('E0', 'C', 1, null),
  ('E0', 'C', 2, null),
  ('E0', 'C', 3, null),
  ('E0', 'C', 4, null),
  ('E0', 'C', 5, null),
  ('E0', 'C', 6, null),
  ('E0', 'C', 7, null),
  ('E0', 'C', 8, null),
  ('E0', 'C', 9, null),
  ('E1', null, 1, null),
  ('E1', null, 2, 'A'),
  ('E1', null, 2, 'B'),
  ('E1', null, 3, 'A'),
  ('E1', null, 3, 'B'),
  ('E1', null, 4, 'A'),
  ('E1', null, 4, 'B'),
  ('E1', null, 5, 'A'),
  ('E1', null, 5, 'B'),
  ('E1', null, 6, null),
  ('E2', null, 1, null),
  ('E2', null, 2, null),
  ('E2', null, 3, null),
  ('E2', null, 4, null),
  ('E2', null, 5, null),
  ('E2', null, 6, null),
  ('E2', null, 7, null),
  ('E2', null, 8, null),
  ('E3', null, 1, null),
  ('E3', null, 2, null),
  ('E3', null, 3, null),
  ('E3', null, 4, null),
  ('E3', null, 5, null),
  ('E3', null, 6, null),
  ('E3', null, 7, null),
  ('E3', null, 8, null),
  ('E4', null, 1, null),
  ('E4', null, 2, 'A'),
  ('E4', null, 2, 'B'),
  ('E4', null, 3, 'A'),
  ('E4', null, 3, 'B'),
  ('E4', null, 4, 'A'),
  ('E4', null, 4, 'B'),
  ('E4', null, 5, 'A'),
  ('E4', null, 5, 'B'),
  ('E4', null, 6, 'A'),
  ('E4', null, 6, 'B'),
  ('E4', null, 7, 'A'),
  ('E4', null, 7, 'B'),
  ('E5', null, 1, null),
  ('E5', null, 2, null),
  ('E5', null, 3, null),
  ('E5', null, 4, null),
  ('E5', null, 5, null),
  ('E5', null, 6, null),
  ('E5', null, 7, null);
