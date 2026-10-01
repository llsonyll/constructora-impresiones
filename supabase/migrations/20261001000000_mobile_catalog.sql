-- Catálogo desde el celular: SKU automático, foto de producto y bucket de imágenes.

-- SKU automático para productos creados al vuelo (POS / "Poner precios"); se puede editar luego.
create sequence if not exists product_sku_seq;
alter table products alter column sku set default 'NUE-' || lpad(nextval('product_sku_seq')::text, 4, '0');

-- Foto: ruta dentro del bucket "product-images" (no URL completa, por si cambia el dominio).
alter table products add column image_path text;

-- Bucket público de lectura (fotos de catálogo, no son sensibles); escritura solo admin/almacén.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2 * 1024 * 1024, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.has_role('admin', 'almacen')));
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.has_role('admin', 'almacen')))
  with check (bucket_id = 'product-images' and (select public.has_role('admin', 'almacen')));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.has_role('admin', 'almacen')));
