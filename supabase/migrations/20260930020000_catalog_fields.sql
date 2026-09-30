-- Catálogo: productos pueden existir sin precio (pendientes), pero nunca activos sin precio.
alter table products alter column price drop not null;
alter table products add constraint products_active_needs_price check (not active or price is not null);

alter table products add column brand        text;
alter table products add column notes        text;     -- origen del precio, conversiones de empaque, dudas
alter table products add column needs_review boolean not null default false;

create index products_needs_review_idx on products (needs_review) where needs_review;
