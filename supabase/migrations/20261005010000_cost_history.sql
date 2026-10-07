-- Historial de costos de compra. product_costs.cost queda como referencia nominal (el último costo);
-- cada cambio se guarda aquí con su origen:
--   compra  → al recibir una orden (con proveedor, OC y cantidad), lo inserta receive_purchase_order
--   manual  → edición del costo en el inventario (trigger sobre product_costs)
--   inicial → costos que ya existían al crear esta tabla (importación del catálogo)
-- Costos siempre con IGV, como product_costs.

create table product_cost_history (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references products(id) on delete cascade,
  cost        numeric(12,4) not null check (cost >= 0),
  source      text not null check (source in ('compra', 'manual', 'inicial')),
  provider_id uuid references providers(id) on delete set null,
  po_id       uuid references purchase_orders(id) on delete set null,
  qty         numeric(12,3),
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index product_cost_history_product_idx  on product_cost_history (product_id, created_at desc);
create index product_cost_history_provider_idx on product_cost_history (provider_id);
create index product_cost_history_po_idx       on product_cost_history (po_id);
create index product_cost_history_user_idx     on product_cost_history (created_by);

-- Solo lectura para admin/almacén; se escribe únicamente desde el trigger y el RPC (security definer).
alter table product_cost_history enable row level security;
create policy cost_history_read on product_cost_history for select to authenticated
  using ((select public.has_role('admin', 'almacen')));

insert into product_cost_history (product_id, cost, source, provider_id, created_by, created_at)
select c.product_id, c.cost, 'inicial', p.provider_id, null, c.updated_at
  from product_costs c join products p on p.id = c.product_id;

-- Cambios de costo fuera de una recepción (editor de inventario) → 'manual'.
create or replace function public.log_cost_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.cost_source', true), '') = 'compra' then return new; end if;
  if tg_op = 'UPDATE' and new.cost is not distinct from old.cost then return new; end if;
  insert into product_cost_history (product_id, cost, source, provider_id)
  select new.product_id, new.cost, 'manual', p.provider_id from products p where p.id = new.product_id;
  return new;
end $$;
revoke execute on function public.log_cost_change() from public, anon, authenticated;
create trigger product_costs_history after insert or update on product_costs
  for each row execute function log_cost_change();

-- Recibir: igual que antes, y además cada producto queda en el historial como 'compra'.
create or replace function public.receive_purchase_order(p_po_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_po      purchase_orders;
  v_factor  numeric;
  v_label   text;
  v_summary jsonb;
begin
  if not public.has_role('admin', 'almacen') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found or v_po.status not in ('borrador', 'enviada') then
    raise exception 'La orden no existe o ya fue procesada';
  end if;
  if not exists (select 1 from purchase_order_items where po_id = p_po_id) then
    raise exception 'La orden no tiene productos';
  end if;
  v_factor := case when v_po.costs_include_igv then 1 else 1.18 end;
  v_label  := 'OC-' || lpad(v_po.number::text, 4, '0')
              || coalesce(' · ' || (select name from providers where id = v_po.provider_id), '')
              || coalesce(' · ' || v_po.invoice_ref, '');

  create temp table _po_lines on commit drop as
  select i.product_id, sum(i.qty) as qty, round(sum(i.qty * i.unit_cost) / sum(i.qty) * v_factor, 4) as cost
    from purchase_order_items i where i.po_id = p_po_id group by i.product_id;

  -- Resumen antes de tocar costos (para mostrar costo anterior → nuevo).
  select jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'name', p.name, 'unit', p.unit, 'qty', l.qty, 'price', p.price,
           'old_cost', c.cost, 'new_cost', l.cost, 'stock', p.stock + l.qty) order by p.name)
    into v_summary
    from _po_lines l join products p on p.id = l.product_id
    left join product_costs c on c.product_id = l.product_id;

  perform set_config('app.receiving_po', p_po_id::text, true);
  update purchase_orders set status = 'recibida', received_at = now(), total = public.po_total(p_po_id)
   where id = p_po_id;
  perform set_config('app.receiving_po', '', true);

  insert into stock_movements (product_id, qty, reason, po_id, note)
  select product_id, qty, 'compra', p_po_id, v_label from _po_lines;

  insert into product_cost_history (product_id, cost, source, provider_id, po_id, qty)
  select product_id, cost, 'compra', v_po.provider_id, p_po_id, qty from _po_lines;

  -- Referencia nominal = último costo de compra (el trigger no lo duplica como 'manual').
  perform set_config('app.cost_source', 'compra', true);
  insert into product_costs (product_id, cost)
  select product_id, cost from _po_lines
  on conflict (product_id) do update set cost = excluded.cost, updated_at = now();
  perform set_config('app.cost_source', '', true);

  update products set provider_id = v_po.provider_id
   where id in (select product_id from _po_lines) and provider_id is null;

  return v_summary;
end $$;
