-- Documentos internos (sin SUNAT): cotizaciones y notas de venta, numeradas por serie (COT-000001, NV-000001).
-- Boletas y facturas electrónicas quedan para más adelante (sunat_status / external_id ya existen en documents).

-- 1) Datos del negocio para el encabezado de los documentos (una sola fila; la edita el admin).
create table if not exists business_info (
  id         smallint primary key default 1 check (id = 1),
  name       text not null default 'La Constructora',
  ruc        text,
  address    text,
  phone      text,
  footer     text,                 -- texto al pie (p. ej. cuentas para depósito, horario)
  updated_at timestamptz not null default now()
);
insert into business_info (id) values (1) on conflict (id) do nothing;
alter table business_info enable row level security;
create policy business_info_read on business_info for select to authenticated
  using ((select public.has_role('admin', 'cajero', 'almacen')));
create policy business_info_update on business_info for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

-- 2) Vigencia (cotizaciones) y anulación. Una sola nota de venta vigente por venta.
alter table documents add column if not exists valid_until date;
alter table documents add column if not exists voided_at   timestamptz;
create unique index if not exists documents_one_note_per_sale on documents (sale_id)
  where type = 'nota_venta' and voided_at is null;
create index if not exists documents_type_created_idx on documents (type, created_at desc);

-- Cualquier cajero puede retomar una cotización (el cliente vuelve otro día y lo atiende otro).
-- Se escribe solo por las RPC de abajo (numeración correlativa).
alter policy documents_read on documents using ((select public.has_role('admin', 'cajero')));

-- Siguiente número de una serie. Bloqueo por serie: dos cajas emitiendo a la vez no repiten número.
create or replace function public.next_document_number(p_type document_type, p_series text) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('documents:' || p_type || ':' || p_series));
  return (select coalesce(max(number), 0) + 1 from documents where type = p_type and series = p_series);
end $$;
revoke execute on function public.next_document_number(document_type, text) from public, anon, authenticated;

-- 3) Cotización: crear o editar (mientras no se haya vendido ni anulado).
-- p = { id?, customer_name?, customer_doc?, phone?, note?, valid_days?, items: [{ product_id?, description, unit?, qty, unit_price }] }
create or replace function public.save_quote(p jsonb) returns documents
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid    := nullif(p->>'id', '')::uuid;
  v_days  int     := coalesce(nullif(p->>'valid_days', '')::int, 7);
  v_items jsonb;
  v_total numeric;
  v_doc   documents;
  v_payload jsonb;
begin
  if not public.has_role('admin', 'cajero') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_days < 1 or v_days > 365 then raise exception 'Vigencia inválida (1 a 365 días)'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'items', '[]')) i
              where nullif(trim(i->>'description'), '') is null
                 or coalesce((i->>'qty')::numeric, 0) <= 0
                 or coalesce((i->>'unit_price')::numeric, -1) < 0) then
    raise exception 'Revisa los ítems: cada uno necesita descripción, cantidad mayor a 0 y precio';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id',  nullif(i->>'product_id', ''),
           'description', trim(i->>'description'),
           'unit',        coalesce(nullif(trim(i->>'unit'), ''), 'und'),
           'qty',         (i->>'qty')::numeric,
           'unit_price',  round((i->>'unit_price')::numeric, 2)) order by n), '[]'::jsonb),
         coalesce(sum(round((i->>'qty')::numeric * round((i->>'unit_price')::numeric, 2), 2)), 0)
    into v_items, v_total
    from jsonb_array_elements(coalesce(p->'items', '[]')) with ordinality as t(i, n);
  if jsonb_array_length(v_items) = 0 then raise exception 'La cotización no tiene ítems'; end if;

  v_payload := jsonb_build_object('items', v_items, 'valid_days', v_days,
                                  'phone', nullif(trim(p->>'phone'), ''), 'note', nullif(trim(p->>'note'), ''));

  if v_id is null then
    insert into documents (type, series, number, customer_name, customer_doc, total, payload, valid_until)
    values ('cotizacion', 'COT', public.next_document_number('cotizacion', 'COT'),
            nullif(trim(p->>'customer_name'), ''), nullif(trim(p->>'customer_doc'), ''), v_total, v_payload,
            (now() at time zone 'America/Lima')::date + v_days)
    returning * into v_doc;
  else
    select * into v_doc from documents where id = v_id and type = 'cotizacion' for update;
    if not found then raise exception 'No existe la cotización'; end if;
    if v_doc.sale_id is not null or v_doc.voided_at is not null then
      raise exception 'La cotización ya se vendió o está anulada: no se puede editar';
    end if;
    update documents
       set customer_name = nullif(trim(p->>'customer_name'), ''), customer_doc = nullif(trim(p->>'customer_doc'), ''),
           total = v_total, payload = v_payload,
           valid_until = (v_doc.created_at at time zone 'America/Lima')::date + v_days
     where id = v_id
    returning * into v_doc;
  end if;
  return v_doc;
end $$;

-- 4) Nota de venta de una venta ya registrada. Los ítems y el total salen de la venta (no del cliente).
-- Si la venta ya tiene nota, devuelve esa (actualizando los datos del cliente si se envían).
-- p = { sale_id, customer_name?, customer_doc?, address? }
create or replace function public.create_sale_note(p jsonb) returns documents
language plpgsql security definer set search_path = public as $$
declare
  v_sale  sales;
  v_doc   documents;
  v_name  text := nullif(trim(p->>'customer_name'), '');
  v_num   text := nullif(trim(p->>'customer_doc'), '');
  v_addr  text := nullif(trim(p->>'address'), '');
  v_items jsonb;
begin
  if not public.has_role('admin', 'cajero') then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into v_sale from sales where id = nullif(p->>'sale_id', '')::uuid;
  if not found then raise exception 'La venta no existe o aún no se sincroniza'; end if;
  if not (public.has_role('admin') or v_sale.cashier_id = auth.uid()) then
    raise exception 'Solo puedes emitir notas de tus ventas' using errcode = '42501';
  end if;
  if v_sale.status = 'anulada' then raise exception 'La venta está anulada'; end if;

  -- Datos del cliente también en la venta (si no los tenía).
  update sales set customer_name = coalesce(customer_name, v_name), customer_doc = coalesce(customer_doc, v_num)
   where id = v_sale.id and (v_name is not null or v_num is not null);

  select * into v_doc from documents where type = 'nota_venta' and sale_id = v_sale.id and voided_at is null for update;
  if found then
    update documents
       set customer_name = coalesce(v_name, customer_name), customer_doc = coalesce(v_num, customer_doc),
           payload = payload || jsonb_strip_nulls(jsonb_build_object('address', v_addr))
     where id = v_doc.id
    returning * into v_doc;
    return v_doc;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', si.product_id, 'description', si.description, 'unit', coalesce(pr.unit, 'und'),
           'qty', si.qty, 'unit_price', si.unit_price) order by si.id), '[]'::jsonb)
    into v_items
    from sale_items si left join products pr on pr.id = si.product_id
   where si.sale_id = v_sale.id;

  insert into documents (type, series, number, sale_id, customer_name, customer_doc, total, payload)
  values ('nota_venta', 'NV', public.next_document_number('nota_venta', 'NV'), v_sale.id,
          coalesce(v_name, v_sale.customer_name), coalesce(v_num, v_sale.customer_doc), v_sale.total,
          jsonb_strip_nulls(jsonb_build_object('items', v_items, 'address', v_addr, 'payment_method', v_sale.payment_method,
                                               'caja', v_sale.caja, 'sale_number', v_sale.number, 'sold_at', v_sale.sold_at)))
  returning * into v_doc;
  return v_doc;
end $$;

-- 5) Cotización → venta: la venta (creada desde el POS, quizá sin internet) queda enlazada a la cotización.
-- Idempotente: si ya estaba enlazada a otra venta, no cambia.
create or replace function public.link_quote_sale(p_quote uuid, p_sale uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('admin', 'cajero') then raise exception 'No autorizado' using errcode = '42501'; end if;
  update documents set sale_id = p_sale
   where id = p_quote and type = 'cotizacion' and sale_id is null and voided_at is null
     and exists (select 1 from sales where id = p_sale);
end $$;

-- 6) Anular: cotizaciones admin y cajero; notas de venta solo admin.
create or replace function public.void_document(p_id uuid) returns documents
language plpgsql security definer set search_path = public as $$
declare v_doc documents;
begin
  select * into v_doc from documents where id = p_id for update;
  if not found then raise exception 'No existe el documento'; end if;
  if not (public.has_role('admin') or (v_doc.type = 'cotizacion' and public.has_role('cajero'))) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_doc.voided_at is not null then return v_doc; end if;
  if v_doc.type = 'cotizacion' and v_doc.sale_id is not null then raise exception 'La cotización ya se vendió'; end if;
  update documents set voided_at = now() where id = p_id returning * into v_doc;
  return v_doc;
end $$;

revoke execute on function public.save_quote(jsonb), public.create_sale_note(jsonb),
                           public.link_quote_sale(uuid, uuid), public.void_document(uuid) from public, anon;
grant  execute on function public.save_quote(jsonb), public.create_sale_note(jsonb),
                           public.link_quote_sale(uuid, uuid), public.void_document(uuid) to authenticated;
