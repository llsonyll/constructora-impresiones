-- Órdenes de compra como lista de pedido: el costo de cada producto puede quedar vacío ("por cotizar") mientras la
-- orden es borrador o enviada; se completa cuando llega la cotización o la factura. Para recibir, todos los
-- productos deben tener costo (receive_purchase_order mueve stock y costos juntos).

alter table purchase_order_items alter column unit_cost drop not null;
-- subtotal (generado: qty × unit_cost) queda en null mientras no hay costo; po_total suma solo los que tienen.

create or replace function public.po_require_costs() returns trigger
language plpgsql set search_path = public as $$
declare v_missing int;
begin
  if new.status = 'recibida' and old.status <> 'recibida' then
    select count(*) into v_missing from purchase_order_items where po_id = new.id and unit_cost is null;
    if v_missing > 0 then
      raise exception 'Faltan los costos de % producto(s): complétalos antes de recibir', v_missing;
    end if;
  end if;
  return new;
end $$;

create trigger purchase_orders_require_costs
  before update of status on purchase_orders
  for each row execute function public.po_require_costs();
