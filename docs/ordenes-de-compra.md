# Órdenes de compra

Flujo completo desde que se decide comprar algo hasta que la mercadería entra al stock.
Vive en `/proveedores/ordenes` (roles: admin, almacén).

## Estados y transiciones

```
borrador
  ├─→ solicitada   (se piden precios al proveedor)
  │    └─→ cotizada    (proveedor responde; automático al guardar con todos los costos)
  │         └─→ enviada    (pedido en firme)
  │              └─→ recibida   (mercadería llega → stock y costos guardados)
  ├─→ enviada      (pedido directo sin cotizar)
  │    └─→ recibida
  └─→ cancelada    (desde cualquier estado abierto)
       └─→ borrador    (reabrir)
```

Una orden **recibida no es editable** (solo se puede corregir el número de factura).

## Qué ocurre al recibir

La RPC `receive_purchase_order` hace todo en una sola transacción:

1. Crea movimientos de stock (`reason = 'compra'`) por cada producto.
2. Registra el nuevo costo en `product_cost_history`.
3. Actualiza el costo nominal en `product_costs`.
4. Asigna el proveedor al producto si no tenía uno.
5. Marca la orden como `recibida` con fecha y hora.

> **Regla importante**: recibir una orden solo se hace desde la app.
> Claude nunca debe llamar a `receive_purchase_order` directamente.

## PDFs que genera la orden

La pantalla `/proveedores/ordenes/:id/pdf` produce dos tipos según el contexto:

| Modo | Cuándo se usa | Columna de precio |
|---|---|---|
| **Solicitud de precios** | Estado `solicitada` o sin ningún costo cargado | En blanco (proveedor completa) |
| **Orden de compra** | Tiene al menos un costo; estados cotizada/enviada/recibida | Muestra costos y total |

Ambos modos muestran: datos del negocio, número de orden, proveedor, tabla de productos,
condiciones y espacio de firmas. **No exponen** SKU, stock ni precios de venta.

## Cómo enviar la orden al proveedor

Desde el botón **Pedir precios** o **Enviar pedido** (según el estado):

1. **WhatsApp**: abre un enlace con el número del proveedor y el texto de la orden.
2. **PDF**: abre la pantalla de PDF para imprimir o guardar.
3. **Ya lo envié de otra forma**: solo cambia el estado, sin abrir ventana.

Las tres opciones registran la fecha correspondiente (`quote_requested_at`, `ordered_at`).

## Resumen de recepción

Tras recibir, la pantalla `ReceiptSummary` permite:

- Revisar costo anterior → nuevo por cada producto.
- Corregir el precio de venta (y activar el producto si estaba inactivo).
- Registrar la ubicación en el estante (suma al existente o crea nueva).
- Cargar foto y notas del producto.

## Archivos relevantes

| Archivo | Qué hace |
|---|---|
| `web/src/features/providers/api.ts` | Tipos, queries y mutations |
| `web/src/features/providers/PurchaseOrderPage.tsx` | Pantalla de edición (~700 líneas) |
| `web/src/features/providers/PurchaseOrderPdfPage.tsx` | Render del PDF |
| `web/src/features/providers/SendOrderSheet.tsx` | Diálogo de envío (WhatsApp / PDF / manual) |
| `web/src/features/providers/ReceiptSummary.tsx` | Pantalla post-recepción |
| `supabase/migrations/20261005000000_purchases.sql` | RPC `save_purchase_order`, `receive_purchase_order`, trigger `po_guard` |
| `supabase/migrations/20261114010000_oc_solicitud_precios.sql` | Estados `solicitada`/`cotizada`, fechas y transiciones |
| `.claude/skills/pedidos/SKILL.md` | Procedimiento para armar una orden desde hoja manuscrita |

## Qué cambiar si algo varía

| Cambio | Dónde |
|---|---|
| Agregar un nuevo estado | Enum en migración nueva + `po_guard` trigger + frontend `api.ts` |
| Cambiar el contenido del PDF | `PurchaseOrderPdfPage.tsx` |
| Cambiar la lógica de transición automática (ej. cotizada) | RPC `save_purchase_order` en migración nueva |
| Cambiar quién puede recibir órdenes | Política RLS sobre `purchase_orders` + `security definer` en RPC |
