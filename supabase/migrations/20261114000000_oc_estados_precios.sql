-- Órdenes de compra: dos estados nuevos para el paso de pedir precios al proveedor.
--   borrador → solicitada (precios pedidos) → cotizada (precios recibidos) → enviada (pedido) → recibida
--   (cancelada desde cualquiera abierta; también se puede pedir o recibir sin pasar por todos).
-- Va sola en su migración: un valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
alter type po_status add value if not exists 'solicitada' before 'enviada';
alter type po_status add value if not exists 'cotizada'   before 'enviada';
