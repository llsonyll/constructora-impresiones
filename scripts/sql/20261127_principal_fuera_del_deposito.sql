-- Productos cuya ubicación principal es un depósito pero que también están en la tienda: la principal pasa a la
-- ubicación de la tienda más antigua (la regla nueva de 20261127180000_vender_desde_tienda, aplicada a lo que ya
-- estaba cargado). Así Ventas muestra el estante y no "D1". No cambia stock ni cantidades. Idempotente: si ya no hay
-- productos en ese caso, no hace nada. Al 27/11/2026 era 1 producto.
update product_locations pl set is_primary = true
  from (select distinct on (o.product_id) o.product_id, o.location_id
          from product_locations o join locations lo on lo.id = o.location_id
         where lo.furniture_type <> 'deposito'
           and exists (select 1 from product_locations p join locations l on l.id = p.location_id
                        where p.product_id = o.product_id and p.is_primary and l.furniture_type = 'deposito')
         order by o.product_id, o.created_at, o.location_id) t
 where pl.product_id = t.product_id and pl.location_id = t.location_id;
