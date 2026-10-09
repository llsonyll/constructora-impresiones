-- Dos cajas: Ferretería y Copias y librería (fotocopias, impresiones, librería).
-- Cada categoría pertenece a una caja; cada venta, a una sola caja (la que eligió el cajero en el POS).
-- Productos sin categoría y los ítems libres van a la caja de la venta.

create type caja as enum ('ferreteria', 'copias');

alter table categories add column caja caja not null default 'ferreteria';

-- "Impresión y fotocopia" se separa en Impresiones y Fotocopias (las de la copiadora Konica).
update categories set name = 'Impresiones' where name = 'Impresión y fotocopia';
insert into categories (name) values ('Fotocopias'), ('Impresiones'), ('Librería') on conflict (name) do nothing;
update categories set caja = 'copias' where name in ('Fotocopias', 'Impresiones', 'Librería');
update products set category_id = (select id from categories where name = 'Fotocopias')
 where 'konica-copia' = any(job_sources)
   and category_id is not distinct from (select id from categories where name = 'Impresiones');

alter table sales add column caja caja not null default 'ferreteria';
create index sales_caja_sold_at_idx on sales (caja, sold_at desc);

-- Ventas anteriores: las que solo tienen servicios (y quizá ítems libres) eran de copias.
update sales s set caja = 'copias'
 where exists (select 1 from sale_items i join products p on p.id = i.product_id
                where i.sale_id = s.id and not p.track_stock)
   and not exists (select 1 from sale_items i join products p on p.id = i.product_id
                    where i.sale_id = s.id and p.track_stock);

-- create_sale: igual que antes, más la caja (las ventas en cola sin caja quedan en ferretería).
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
                     customer_doc, note, sold_at, caja)
  values (v_id, auth.uid(), (p_sale->>'shift')::shift_type,
          (p_sale->>'payment_method')::payment_method, 0,
          nullif(p_sale->>'customer_name',''), nullif(p_sale->>'customer_doc',''),
          nullif(p_sale->>'note',''), coalesce((p_sale->>'sold_at')::timestamptz, now()),
          coalesce(nullif(p_sale->>'caja','')::caja, 'ferreteria'))
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
