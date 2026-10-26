-- Búsqueda con otros nombres: un mismo producto se pide de varias formas ("amarra", "cintillo", "precinto").
-- La búsqueda corre en el equipo (catálogo offline, ver web/src/lib/search.ts); aquí solo se guardan los datos.

-- 1) Otros nombres de un producto ("También se conoce como"): nombres que solo aplican a ese artículo.
alter table products add column if not exists aliases text[] not null default '{}';

-- 2) Sinónimos compartidos: cada fila es un grupo de palabras o frases equivalentes. Buscar una encuentra las demás.
-- Una línea cubre toda una familia de productos sin editar cada uno.
create table if not exists search_synonyms (
  id         bigint generated always as identity primary key,
  terms      text[] not null check (cardinality(terms) >= 2),
  updated_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists search_synonyms_updated_by_idx on search_synonyms (updated_by);
alter table search_synonyms enable row level security;
-- Todos los roles los leen (se descargan con el catálogo); los editan admin y almacén, igual que los productos.
create policy search_synonyms_read on search_synonyms for select to authenticated
  using ((select public.has_role('admin', 'cajero', 'almacen')));
create policy search_synonyms_insert on search_synonyms for insert to authenticated
  with check ((select public.has_role('admin', 'almacen')));
create policy search_synonyms_update on search_synonyms for update to authenticated
  using ((select public.has_role('admin', 'almacen'))) with check ((select public.has_role('admin', 'almacen')));
create policy search_synonyms_delete on search_synonyms for delete to authenticated
  using ((select public.has_role('admin', 'almacen')));

-- 3) Lista inicial (ferretería, electricidad, gasfitería, pinturas y librería), armada con los nombres del catálogo.
-- Se edita en Inventario → Sinónimos. Las frases sin "de/para/con" valen igual ("cinta de aislar" = "cinta aislar").
insert into search_synonyms (terms)
select t from (values
  (array['amarra', 'cintillo', 'precinto', 'sujetacable', 'cable tie']),
  (array['wincha', 'huincha', 'flexómetro', 'cinta métrica']),
  (array['desarmador', 'destornillador']),
  (array['tarugo', 'taco', 'fischer']),
  (array['tomacorriente', 'toma', 'enchufe']),
  (array['extensión', 'extención', 'alargador', 'zapatilla', 'regleta']),
  (array['foco', 'bombilla', 'bombillo', 'ampolleta']),
  (array['cinta aislante', 'cinta de aislar', 'temflex']),
  (array['cinta masking', 'masking', 'masking tape', 'cinta de papel', 'cinta de pintor']),
  (array['cinta de embalaje', 'cinta de empaque', 'cinta para embalar', 'cinta transparente']),
  (array['cinta de conducto', 'duct tape', 'cinta americana', 'cinta plateada']),
  (array['silicona', 'silicón', 'sikasil', 'sanisil']),
  (array['sellador', 'sikaflex', 'poliuretano']),
  (array['pegamento', 'peggamen', 'pegamen', 'terokal', 'cola sintética', 'goma']),
  (array['thinner', 'thiner', 'diluyente']),
  (array['combo', 'comba', 'mazo']),
  (array['segueta', 'hoja de sierra']),
  (array['llave francesa', 'llave ajustable']),
  (array['alicate', 'pinza']),
  (array['cerradura', 'chapa', 'cantol']),
  (array['cutter', 'cúter', 'cuchilla', 'estilete']),
  (array['autoperforante', 'autoperf', 'autop']),
  (array['tirafón', 'tirafondo']),
  (array['desatorador', 'destapador', 'chupón', 'sopapa']),
  (array['caño', 'grifo']),
  (array['mameluco', 'overol', 'tivet']),
  (array['brocha', 'pincel']),
  (array['spray', 'aerosol']),
  (array['lapicero', 'bolígrafo', 'lapicera', 'lápiz de pasta']),
  (array['corrector', 'liquid paper', 'tipex']),
  (array['mica', 'funda plástica', 'protector de hojas']),
  (array['fastener', 'gancho de folder', 'fierrito']),
  (array['tampón', 'almohadilla', 'huellero']),
  (array['tajador', 'tarjador', 'sacapuntas']),
  (array['borrador', 'goma de borrar']),
  (array['fotocopia', 'copia', 'xerox']),
  (array['impresión', 'imprimir']),
  (array['escaneo', 'escanear', 'scan'])
) as v(t)
where not exists (select 1 from search_synonyms);
