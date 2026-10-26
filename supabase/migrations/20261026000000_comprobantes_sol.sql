-- Boletas y facturas emitidas a mano en el portal SOL de SUNAT, registradas en su venta.
-- No se emiten desde aquí (eso queda para la emisión electrónica vía OSE/PSE): solo se anota la serie y el número
-- para saber qué ventas tienen comprobante. El PDF válido es el de SOL; la app no imprime estos registros.
-- payload.source = 'sol' los distingue de los que en el futuro emita un proveedor.

-- Un solo comprobante (boleta o factura) vigente por venta. Quitar el registro (void_document, admin) libera la venta.
create unique index if not exists documents_one_receipt_per_sale on documents (sale_id)
  where type in ('boleta', 'factura') and voided_at is null;

-- RUC: 11 dígitos, prefijo de contribuyente (10, 15, 16, 17, 20) y dígito verificador (módulo 11).
create or replace function public.ruc_valido(p text) returns boolean
language sql immutable set search_path = public as $$
  select case when coalesce(p ~ '^(10|15|16|17|20)[0-9]{9}$', false)
    then (11 - (select sum(substr(p, i, 1)::int * (array[5,4,3,2,7,6,5,4,3,2])[i]) from generate_series(1, 10) i) % 11) % 10
         = substr(p, 11, 1)::int
    else false end
$$;

-- p = { sale_id, type: 'boleta'|'factura', series, number, customer_name?, customer_doc? }
-- Idempotente: registrar otra vez el mismo comprobante en la misma venta devuelve el existente.
create or replace function public.register_sol_receipt(p jsonb) returns documents
language plpgsql security definer set search_path = public as $$
declare
  v_sale   sales;
  v_doc    documents;
  v_type   document_type;
  v_series text := upper(trim(coalesce(p->>'series', '')));
  v_number bigint;
  v_name   text := nullif(trim(p->>'customer_name'), '');
  v_num    text := nullif(regexp_replace(coalesce(p->>'customer_doc', ''), '\s', '', 'g'), '');
  v_label  text;
  v_reuse  boolean;
begin
  if not public.has_role('admin', 'cajero') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p->>'type' not in ('boleta', 'factura') then raise exception 'Tipo de comprobante inválido'; end if;
  v_type := (p->>'type')::document_type;

  select * into v_sale from sales where id = nullif(p->>'sale_id', '')::uuid;
  if not found then raise exception 'La venta no existe o aún no se sincroniza'; end if;
  if not (public.has_role('admin') or v_sale.cashier_id = auth.uid()) then
    raise exception 'Solo puedes registrar comprobantes de tus ventas' using errcode = '42501';
  end if;
  if v_sale.status = 'anulada' then raise exception 'La venta está anulada'; end if;

  -- Serie: SOL usa EB01 (boleta) y E001 (factura); un proveedor, B001 / F001; las impresas, 0001.
  if v_type = 'boleta' and v_series !~ '^(B[A-Z0-9]{3}|EB[0-9]{2}|[0-9]{4})$' then
    raise exception 'Serie de boleta inválida (p. ej. EB01)';
  end if;
  if v_type = 'factura' and v_series !~ '^(F[A-Z0-9]{3}|E[0-9]{3}|[0-9]{4})$' then
    raise exception 'Serie de factura inválida (p. ej. E001)';
  end if;
  if coalesce(p->>'number', '') !~ '^[0-9]{1,8}$' or (p->>'number')::bigint = 0 then
    raise exception 'Número inválido (1 a 99999999)';
  end if;
  v_number := (p->>'number')::bigint;
  if v_type = 'factura' and not public.ruc_valido(v_num) then raise exception 'La factura necesita un RUC válido (11 dígitos)'; end if;
  if v_type = 'factura' and v_name is null then raise exception 'La factura necesita la razón social del cliente'; end if;
  v_label := initcap(v_type::text) || ' ' || v_series || '-' || v_number;

  -- ¿Ese comprobante ya está registrado?
  select * into v_doc from documents where type = v_type and series = v_series and number = v_number for update;
  v_reuse := found;
  if v_reuse and v_doc.voided_at is null then
    if v_doc.sale_id = v_sale.id then return v_doc; end if;
    raise exception '% ya está registrada en otra venta', v_label;
  end if;

  if exists (select 1 from documents where sale_id = v_sale.id and type in ('boleta', 'factura') and voided_at is null) then
    raise exception 'La venta ya tiene un comprobante registrado';
  end if;

  update sales set customer_name = coalesce(customer_name, v_name), customer_doc = coalesce(customer_doc, v_num)
   where id = v_sale.id and (v_name is not null or v_num is not null);

  if v_reuse then
    -- Registro quitado antes (p. ej. se anotó en la venta equivocada): se reutiliza (serie y número son únicos).
    update documents
       set sale_id = v_sale.id, customer_name = v_name, customer_doc = v_num, total = v_sale.total, voided_at = null,
           created_by = auth.uid(), created_at = now(),
           payload = jsonb_build_object('source', 'sol', 'caja', v_sale.caja, 'sale_number', v_sale.number, 'sold_at', v_sale.sold_at)
     where id = v_doc.id
    returning * into v_doc;
    return v_doc;
  end if;

  insert into documents (type, series, number, sale_id, customer_name, customer_doc, total, sunat_status, payload)
  values (v_type, v_series, v_number, v_sale.id, v_name, v_num, v_sale.total,
          'aceptado',   -- emitida en SOL: SUNAT ya la tiene
          jsonb_build_object('source', 'sol', 'caja', v_sale.caja, 'sale_number', v_sale.number, 'sold_at', v_sale.sold_at))
  returning * into v_doc;
  return v_doc;
end $$;

revoke execute on function public.ruc_valido(text) from public, anon;
grant  execute on function public.ruc_valido(text) to authenticated;
revoke execute on function public.register_sol_receipt(jsonb) from public, anon;
grant  execute on function public.register_sol_receipt(jsonb) to authenticated;
