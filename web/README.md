# La Constructora — plataforma (web)

React + TS + Vite + Tailwind + TanStack Query + Dexie (offline) + Supabase.
La app actual de impresiones (`/index.html`, Firebase) sigue intacta en la raíz del repo.

## Estructura

```
supabase/
  migrations/   esquema SQL + RLS (fuente de verdad del modelo)
  seed.sql      categorías iniciales + cómo crear el primer admin
web/
  src/
    features/   un directorio por módulo: pos/ inventory/ providers/ documents/ auth/
    db/         Dexie: catálogo en caché + cola de ventas (outbox)
    lib/        supabase client, formato de moneda, turno
    components/ layout y UI compartida
    routes/     rutas protegidas por rol
    types/      tipos de dominio
```

## Puesta en marcha

Proyecto Supabase: `la-constructora` (`fsrlcvuhcfbojbextoax`, región sa-east-1). Migraciones de
`supabase/migrations/` ya aplicadas + categorías de `seed.sql`.

1. Nuevos usuarios: invitar el correo antes de crear la cuenta y nace con ese rol y activo:
   `insert into role_invites (email, role) values ('correo@ejemplo.com', 'cajero');`
   Luego Supabase → Authentication → Users → *Add user* (marcar *Auto Confirm User*).
2. Usuario ya creado sin invitación: `update profiles set role='cajero', active=true where id='<uuid>';`
3. `cd web && npm install && npm run dev` (usa `.env.development`).

`.env.development` / `.env.production` contienen solo la **clave publicable** (es pública por diseño,
viaja en el JS del navegador; la seguridad la da RLS). Nunca poner ahí la `service_role`/secret key.

Precios: el catálogo guarda precios **con IGV incluido**; el POS desglosa Op. gravada + IGV 18%.

Los usuarios nuevos quedan `active=false` hasta que un admin los apruebe.

## Inventario (admin, almacén)

- Lista con filtros *Sin precio / Por revisar / Stock bajo / Inactivos*, costo y margen.
- Editor: poner precio activa el producto (aparece en el POS); sugerencias de precio por recargo sobre costo.
- Stock solo cambia por movimientos: ajuste individual (`adjust_stock`) o **Conteo de stock**
  (`bulk_adjust_stock`, una transacción; el borrador del conteo se guarda en el navegador).

## Proveedores y compras (admin, almacén)

- **Proveedores**: alta/edición (RUC, contacto, teléfono con enlace a WhatsApp). No se borran: se desactivan.
- **Órdenes de compra** (`OC-0001…`): borrador → enviada → **recibida** (o cancelada).
  Agregar productos buscando o escaneando, *+ stock bajo del proveedor*, o crear uno nuevo al vuelo.
  Costos con o sin IGV por orden (si son sin IGV, al costo del producto se le suma 18%).
  *Pedir por WhatsApp* arma el mensaje con la lista y marca la orden como enviada.
- **Recibir** (`receive_purchase_order`, una transacción): entra el stock (movimiento `compra` con la
  OC y la factura), cada costo queda en el historial y el producto sin proveedor queda asignado.
  Luego muestra costo anterior → nuevo y margen, para corregir precios ahí mismo.
- **Historial de costos** (`product_cost_history`): cada compra (proveedor, OC, cantidad), cada cambio
  manual y los costos iniciales del catálogo. `product_costs.cost` es solo la referencia nominal (el
  último). Se ve en el editor del producto y, en la orden, la última compra con proveedor y fecha.
- Reglas en la BD (`po_guard`): una orden recibida no se edita ni se borra (solo el N° de factura) y
  solo se recibe por el RPC.

## Celular: escaneo, fotos y alta rápida

- **Escaneo**: cámara trasera; detector nativo (Chrome/Android) o ZXing-WASM (iPhone). El `.wasm` va
  empaquetado y precacheado por la PWA, así que escanea sin internet.
- **Fotos**: se comprimen en el teléfono (1024 px, JPEG ~100 KB) y se suben al bucket público
  `product-images`; escritura solo admin/almacén. Ruta en `products.image_path`.
- **Poner precios** (`/inventario/precios`): tarjetas una por una (sin precio / sin foto / sin código),
  escanear para saltar al producto, asignar código, foto y precio → *Guardar y siguiente*.
- **POS**: escanear agrega al ticket; si el código no existe, alta rápida (nombre + precio, SKU `NUE-0001…`,
  marcado *por revisar*) y se agrega. Sin internet o sin permiso → ítem libre.

## Dos cajas: Ferretería y Copias y librería

- Cada categoría tiene su caja (`categories.caja`): *Fotocopias*, *Impresiones* y *Librería* van a **Copias y librería**;
  el resto (y los productos sin categoría) a **Ferretería**. Para mover un producto de caja, cambia su categoría.
- En **Ventas** se elige la caja arriba (queda guardada en el equipo). Cada caja tiene su color, su catálogo, sus
  categorías como filtros y su propio ticket (se puede dejar uno a medias y atender en la otra).
- Cada venta queda con su caja (`sales.caja`, la envía `create_sale`). Escanear un producto de la otra caja lo lleva a su
  ticket y cambia de caja; al buscar, se avisa cuántos resultados hay en la otra caja.
- Copias e impresiones (servicios) abren un teclado de cantidad: tocar *Fotocopia B/N* → `1` `5` → *Agregar*, o los
  atajos 10/20/50/100. Sin búsqueda, los productos más usados en el equipo salen primero.
- *Hoy* y *Reportes* separan totales y medios de pago por caja, y suman por categoría.

## Ventas de hoy (`/hoy`)

- Ventas de un día (hoy por defecto, se puede elegir otra fecha): por caja (total y medios de pago, para cuadrar cada
  caja), por categoría y tabla caja × turno. Filtro por caja.
- Filtros por turno, medio de pago y cajero (solo admin). RLS: el cajero ve solo sus ventas; el admin, todas.
- Incluye las ventas que siguen en la cola del equipo (⏳ por sincronizar) y se actualiza en vivo (Realtime en `sales`).
- Detalle de cada venta al tocarla; **Anular venta** solo admin (`void_sale`, repone el stock). Las anuladas no suman y
  se pueden ver con *Ver anuladas*.

## Reportes (`/reportes`, solo admin)

- Rango de fechas (desde/hasta, ambos inclusive, en hora local) con atajos: hoy, ayer, últimos 7 días, este mes, mes pasado.
- Filtros por turno, medio de pago y cajero. Total, número de ventas, ticket promedio, anuladas y **margen estimado**
  (solo con las líneas que tienen costo registrado al vender, `sale_items.unit_cost`; se indica qué % de las ventas cubre).
- Filtro por caja. Medio de pago, categoría, tabla caja × turno, ventas por día y caja y productos más vendidos (por categoría).
- **Exportar CSV**: una fila por línea de venta (incluye anuladas con su estado), UTF-8 con BOM para Excel.
- Las consultas paginan de a 1000 ventas (límite de PostgREST), así que sirven para rangos largos.

## Historial de Firebase (app de impresiones)

Las 184 ventas de `/index.html` (25/09 – 07/10/2026) están importadas en `sales` con `legacy_ref` = id de Firebase
(migración `20261009150000_legacy_firebase_import`). Productos del catálogo antiguo → servicios `IMP-0xx`;
impresiones/fotocopias "Personalizado" → `IMP-900`; "Otros" → ítems libres. Todas en la caja *Copias y librería*
(`20261009160000_legacy_import_caja`), sin movimientos de stock; recibieron los números de venta 23–206.
"Yo"/"Hermano" se asignan con `legacy_user_map`. Si aparecieran ventas nuevas en Firebase, se pueden importar
de nuevo con `select import_legacy_sales('<respaldo JSON de index.html>'::jsonb)` como admin: las ya importadas se omiten.

## Impresiones y copias (POS)

- Productos de las categorías *Fotocopias* e *Impresiones* son **servicios** (`track_stock = false`): se venden por hoja y no
  descuentan stock (`create_sale` no genera movimientos para ellos). En Inventario se marcan con *Servicio (no lleva stock)*.
- Botón 🖨️ en Ventas: trabajos que detecta el agente local (`http://localhost:4000`). Se reparten las hojas entre los
  productos (columnas `job_sources`, `job_color`, `job_duplex`, `job_keywords`; se editan en la sección
  *Trabajos detectados* del producto), con precio editable solo para esa venta; las hojas sin asignar quedan pendientes.
- La lógica es la misma de `/index.html`: vive en `../shared/print/` (alias `@shared`) y `features/print/adapter.ts`
  traduce `products` a la forma que espera.
- El agente debe permitir el dominio de Vercel en `localServer.allowedOrigin` (ver `collector-agent/README.md`).

## Offline (POS)

`checkout()` guarda la venta en Dexie con un UUID generado en el cliente y `flushOutbox()` la envía con la
RPC `create_sale`, que es idempotente por ese UUID: reintentar nunca duplica ventas ni descuenta stock dos veces.

## Despliegue (Vercel)

Vercel → *Add New Project* → importar el repo → **Root Directory: `web`** → Deploy.
`vercel.json` fija build/salida y evita que `sw.js` quede cacheado (actualizaciones de la PWA).
Luego agregar el dominio de Vercel en Supabase → Authentication → URL Configuration (*Site URL*).
