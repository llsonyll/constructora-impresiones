-- Presentaciones de venta: un producto se vende por unidad (su unidad base, la del stock) y además por docena,
-- ciento, bolsa… cada una con su cantidad en unidades base y su precio. Ej. TIRAFON 8x1: und S/0.30,
-- Docena (12) S/3.00, Ciento (100) S/20.00; CLAVO 3" (kg): Bolsa (5 kg) S/28.00.
-- Vender 1 docena descuenta 12 del stock. El stock y los conteos siguen en la unidad base.

alter table products add column if not exists presentations jsonb not null default '[]'
  check (jsonb_typeof(presentations) = 'array');
comment on column products.presentations is
  'Presentaciones de venta: [{ "name": "Docena", "qty": 12, "price": 3.00 }]. qty en la unidad base (products.unit).';

-- Cuántas unidades base lleva cada unidad vendida de la línea (1 = se vendió en la unidad base).
alter table sale_items add column if not exists factor numeric(12,3) not null default 1 check (factor > 0);

-- create_sale: igual que antes + `factor` opcional por ítem (ventas en cola de equipos sin actualizar: 1).
-- Stock: qty × factor. unit_cost: costo de la unidad base × factor (el margen sigue siendo subtotal − unit_cost × qty).
create or replace function public.create_sale(p_sale jsonb) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := (p_sale->>'id')::uuid;
  v_sale   sales;
  v_item   jsonb;
  v_total  numeric(12,2) := 0;
  v_qty    numeric;
  v_price  numeric;
  v_cost   numeric;
  v_track  boolean;
  v_factor numeric;
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
                     customer_doc, note, sold_at, caja)
  values (v_id, auth.uid(), (p_sale->>'shift')::shift_type,
          (p_sale->>'payment_method')::payment_method, 0,
          nullif(p_sale->>'customer_name',''), nullif(p_sale->>'customer_doc',''),
          nullif(p_sale->>'note',''), coalesce((p_sale->>'sold_at')::timestamptz, now()),
          coalesce(nullif(p_sale->>'caja','')::caja, 'ferreteria'))
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_sale->'items') loop
    v_qty    := (v_item->>'qty')::numeric;
    v_price  := (v_item->>'unit_price')::numeric;
    v_factor := coalesce(nullif(v_item->>'factor', '')::numeric, 1);
    if v_factor <= 0 then raise exception 'Presentación inválida en «%»', v_item->>'description'; end if;
    v_cost  := null;
    v_track := false;
    if v_item->>'product_id' is not null then
      select cost into v_cost from product_costs where product_id = (v_item->>'product_id')::uuid;
      select track_stock into v_track from products where id = (v_item->>'product_id')::uuid;
    end if;

    insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, subtotal, factor)
    values (v_id, nullif(v_item->>'product_id','')::uuid, v_item->>'description',
            v_qty, v_price, v_cost * v_factor, round(v_qty * v_price, 2), v_factor);

    if coalesce(v_track, false) then
      insert into stock_movements (product_id, qty, reason, sale_id)
      values ((v_item->>'product_id')::uuid, -(v_qty * v_factor), 'venta', v_id);
    end if;

    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  update sales set total = v_total where id = v_id returning * into v_sale;
  return v_sale;
end $$;

-- save_quote: los ítems guardan `factor` (para que "Pasar a venta" descuente bien el stock).
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
                 or coalesce((i->>'unit_price')::numeric, -1) < 0
                 or coalesce(nullif(i->>'factor', '')::numeric, 1) <= 0) then
    raise exception 'Revisa los ítems: cada uno necesita descripción, cantidad mayor a 0 y precio';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id',  nullif(i->>'product_id', ''),
           'description', trim(i->>'description'),
           -- Línea por presentación: la descripción ya la nombra ("TIRAFON 8x1 · Docena"), sin unidad aparte.
           'unit',        case when coalesce(nullif(i->>'factor', '')::numeric, 1) <> 1 then ''
                               else coalesce(nullif(trim(i->>'unit'), ''), 'und') end,
           'qty',         (i->>'qty')::numeric,
           'unit_price',  round((i->>'unit_price')::numeric, 2),
           'factor',      coalesce(nullif(i->>'factor', '')::numeric, 1)) order by n), '[]'::jsonb),
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

-- create_sale_note: una línea por presentación va sin unidad (la descripción ya la nombra: "TIRAFON 8x1 · Docena").
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
           'product_id', si.product_id, 'description', si.description,
           'unit', case when si.factor = 1 then coalesce(pr.unit, 'und') else '' end,
           'qty', si.qty, 'unit_price', si.unit_price, 'factor', si.factor) order by si.id), '[]'::jsonb)
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
