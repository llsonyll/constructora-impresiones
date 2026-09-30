-- Costos por pieza (pernos, tarugos) necesitan 4 decimales; con 2 el margen sale mal.
alter table product_costs alter column cost      type numeric(12,4);
alter table sale_items    alter column unit_cost type numeric(12,4);

-- subtotal es generado a partir de unit_cost: se recrea.
alter table purchase_order_items drop column subtotal;
alter table purchase_order_items alter column unit_cost type numeric(12,4);
alter table purchase_order_items add column subtotal numeric(12,2)
  generated always as (round(qty * unit_cost, 2)) stored;
