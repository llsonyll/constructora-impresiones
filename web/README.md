# La Constructora — plataforma (web)

React + TS + Vite + Tailwind + TanStack Query + Dexie (offline) + Supabase.
La antigua app de impresiones (`/index.html`, Firebase) se retiró el 13/10/2026; su historial está importado (ver abajo).

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

- Lista pensada para el celular: buscador fijo arriba (nombre, marca, SKU o código; 📷 escanea), dos selectores
  (estado: *Sin precio / Por revisar / Stock bajo / Inactivos / Recientes* y categoría) y filas con precio y stock.
  En escritorio se ven además categoría, costo y margen. Se dibujan 60 filas y *Ver más* agrega otras tantas.
- Agregar: botón flotante *+ Nuevo* en el celular, o *+ Crear «…»* cuando la búsqueda no encuentra nada (precarga el nombre).
- El editor muestra primero nombre, precio y costo (con sugerencias de recargo), y *Guardar* queda fijo al pie.
- Editor: poner precio activa el producto (aparece en el POS); sugerencias de precio por recargo sobre costo.
- Stock solo cambia por movimientos: ajuste individual (`adjust_stock`) o **Conteo de stock**
  (`bulk_adjust_stock`, una transacción; el borrador del conteo se guarda en el navegador).

## Búsqueda de productos: sinónimos y otros nombres

Un mismo producto se pide de varias formas ("amarra", "cintillo", "precinto"). Una sola búsqueda (`src/lib/search.ts`,
hook `useProductMatcher`) en Ventas, Inventario, Conteo, Precios, Ubicaciones, Órdenes de compra y Cotizaciones:
- Sin mayúsculas ni tildes ("tuberia" = TUBERÍA), palabras en cualquier orden ("amarra negra") y por la raíz de cada
  palabra ("amarra", "amarre" y "amarras"; "cintillo" y "cintillos"). Lo escrito se busca en cualquier parte del nombre,
  la marca o el SKU, como antes ("flex" encuentra SIKAFLEX). El código de barras o SKU exacto sale primero.
- **Otros nombres** del producto (`products.aliases`): campo *También se conoce como* en la ficha (separados por coma).
  Para nombres que solo aplican a ese artículo.
- **Sinónimos** compartidos (`search_synonyms`, un grupo por fila): buscar una palabra o frase del grupo encuentra las
  demás ("cintillo" → AMARRA PLÁSTICA; "cinta métrica" → WINCHA, HUINCHA, FLEXÓMETRO; "sacapuntas" → TARJADOR). Un sinónimo
  cuenta como palabra entera ("toma" no trae TOMATIERRA) y los grupos no se encadenan. Las palabras *de, para, con…* no
  cuentan ("cinta de aislar" = "cinta aislar"). Lista inicial de 38 grupos armada con los nombres del catálogo.
- Orden: lo escrito en el nombre, luego en otros nombres, luego por sinónimo; a igual coincidencia, el orden de
  siempre (en Ventas, lo más usado en el equipo).
- **Inventario → Sinónimos** (`/inventario/sinonimos`, admin y almacén): ver, buscar, crear, editar y eliminar grupos
  (al menos dos términos; avisa si una palabra ya está en otro grupo) y *Probar la búsqueda*. RLS: todos leen,
  escriben admin y almacén. Los sinónimos se descargan con el catálogo (Dexie `synonyms`), así la búsqueda funciona sin
  internet; al abrir la pantalla de Sinónimos el equipo los actualiza en el momento.

## Presentaciones: venta por docena, ciento, bolsa…

- Un producto se vende en su unidad base (`products.unit`, la del stock) al precio de venta y, además, en las
  presentaciones de `products.presentations` (`[{ name, qty, price }]`, `qty` en la unidad base). Ej. TIRAFON 8x1:
  und S/0.30, Docena (12) S/3.00, Ciento (100) S/20.00; CLAVO por kg: Bolsa (5 kg).
- Se cargan en la ficha del producto (*Presentaciones*, atajos Docena, Ciento, Bolsa…); muestra el precio por unidad
  base y cuánto más barato sale que suelto.
- En Ventas, tocar un producto con presentaciones abre el selector (`features/pos/PresentationPicker.tsx`): suelto,
  docena, ciento… con cantidades; "1 docena y 3 sueltos" = dos líneas en el ticket. La línea de una presentación se
  describe "TIRAFON DE 8x1 PULGADA · Docena" y lleva `factor` (unidades base por unidad vendida).
- `create_sale` guarda `sale_items.factor`, descuenta `qty × factor` del stock y el costo como `costo base × factor`
  (el margen de Reportes sigue siendo `subtotal − unit_cost × qty`). Anular repone lo mismo. Ventas sin `factor`
  (equipos sin actualizar) cuentan como 1.
- Cotizaciones: al buscar un producto se ofrecen también sus presentaciones; *Pasar a venta* conserva el `factor`.
  En cotizaciones y notas de venta la línea de una presentación va sin unidad aparte (la descripción ya la nombra).
- El stock, los conteos y las compras siguen en la unidad base.

## Ubicaciones físicas (`/inventario/ubicaciones`)

- Código `MUEBLE[-CUERPO]-NIVEL[-SECCIÓN]` (p. ej. `E2-N5`, `E4-N3-B`, `E0-B-N2-F`): nivel contado de **arriba hacia abajo**
  (N1 = repisa más alta), sección de izquierda a derecha. En `locations` las partes van por separado (`furniture`,
  `body`, `level`, `slot`) y `code` se calcula de ellas (para un plano interactivo más adelante). Cargados E0–E5 (106).
- `product_locations`: un producto puede estar en varias ubicaciones; una es la **principal** (la primera que se asigna;
  los triggers mantienen una sola y, al quitarla, pasa a otra). `qty` es solo **referencial**: el stock real es
  `products.stock` (movimientos) y no se descuenta por ubicación.
- Pantalla *Ubicaciones*: mueble → cuadrícula por nivel/sección con cuántos productos hay; tocar un casillero muestra
  sus productos y permite agregar buscando o **escaneando seguido** (código desconocido → alta rápida). *Ir a…* acepta
  `e2n5`. *+ Ubicación* crea una o un mueble entero (niveles desde/hasta × secciones). Con productos no se elimina:
  se desactiva. *Editar mueble* corrige un mueble entero (niveles, secciones por nivel, código, tipo) o lo elimina,
  con la RPC `reshape_furniture` (una transacción; nunca quita una casilla con productos).
- Cada producto de un casillero muestra miniatura, stock y precio; al tocarlo se abre una **vista rápida** (foto, stock,
  precio de venta, cantidad referencial y otras ubicaciones) con **Agregar al ticket** (admin y cajero; va a la caja del producto,
  con *Deshacer* y *Ver ticket*). Los tickets del POS viven en `CartsProvider` (`features/pos/useCart.tsx`), compartidos
  por toda la app y guardados en el equipo (`localStorage` `pos.tickets`): cambiar de pantalla o recargar no los pierde.
- Ficha del producto: sección *Ubicación en tienda* (autocompletado, ★ principal, cantidad, quitar).
- Inventario: 📍 en cada fila, filtro *Sin ubicación* (sin servicios) y búsqueda por código (`E2-N5` o `E4`).
  Ventas: la ubicación principal se ve en la tarjeta (va en el catálogo offline) y también se puede buscar por código.
- Lectura para todos los roles; escritura admin/almacén (RLS). El **cajero** la ve en solo lectura (en *Más*): busca dónde
  está un producto y lo agrega al ticket, sin *+ Ubicación*, *Editar mueble*, *Editar*, agregar/quitar productos ni el
  aviso de *sin ubicación*.

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

## Documentos (`/documentos`, admin y cajero)

Documentos internos, sin SUNAT, numerados por serie en el servidor (`COT-000001`, `NV-000001`; bloqueo por serie, sin
saltos ni repetidos aunque dos cajas emitan a la vez). Tabla `documents` (los ítems van en `payload`), escritura solo
por RPC.
- **Cotización** (`save_quote`): cliente opcional (nombre, DNI/RUC, celular), productos del catálogo local con precio
  editable, ítems libres, vigencia (3/7/15/30 días) y nota. Se crea desde *+ Cotización* o con **Cotizar este ticket**
  en Ventas (el ticket se vacía al guardar). Estados: vigente, vencida, vendida, anulada. Se edita mientras no se venda.
- **Pasar a venta**: carga la cotización en el ticket de cada caja con los precios cotizados (avisa si venció o si el
  ticket ya tenía productos). Al cobrar, la venta lleva el cliente y `quote_id`; al sincronizar, `link_quote_sale` la
  marca como vendida (también si se cobró sin internet). La ✕ del aviso en el ticket cobra sin enlazar.
- **Nota de venta** (`create_sale_note`): desde *Hoy*, en el detalle de una venta ya sincronizada. Ítems y total salen
  de la venta; una sola nota vigente por venta (pedirla otra vez abre la misma y actualiza los datos del cliente).
  El cajero emite notas de sus ventas. Es un documento **interno, no un comprobante de pago**: la hoja no desglosa IGV
  (solo el total) y lleva al pie, también en el WhatsApp, *No válido como comprobante de pago. Solicite su boleta o factura.*
- **Boleta o factura de SOL** (`register_sol_receipt`): mientras no haya emisión electrónica, la boleta o factura se emite
  a mano en el portal SOL de SUNAT y se **anota en su venta** desde *Hoy* (detalle → *Boleta / factura SOL*). La hoja
  muestra los datos de la venta para SOL (precio con IGV, valor unitario sin IGV, op. gravada, IGV, total) con
  *Copiar datos para SOL*, y pide serie y número (por defecto `EB01` boleta, `E001` factura; la última serie usada queda
  en el equipo y se sugiere el siguiente número). Factura: razón social y RUC válido (dígito verificador, `ruc_valido`);
  boleta desde S/ 700: aviso de que debe llevar DNI. Una boleta o factura vigente por venta y cada serie-número en una
  sola venta. Se guarda en `documents` (`payload.source = 'sol'`, `sunat_status = 'aceptado'`); la app **no la imprime**
  (el comprobante válido es el PDF de SOL). El cajero registra en sus ventas; **Quitar registro** solo admin
  (`void_document`; no la anula en SUNAT). En *Hoy* cada venta muestra su comprobante (p. ej. *Boleta EB01-15*), hay
  filtro *Con / Sin boleta ni factura* y, al anular una venta con comprobante, se avisa que hay que anularlo también en SOL.
- Cada documento se ve como hoja A4: **Imprimir / PDF** (`window.print`; al imprimir se ocultan barras y botones) y
  **WhatsApp** (texto con el detalle, al celular del cliente si tiene 9 dígitos). **Anular** (`void_document`):
  cotizaciones admin y cajero; notas de venta solo admin.
- Encabezado y pie: tabla `business_info` (nombre, RUC, dirección, teléfono, pie), editable por el admin con el botón
  del edificio en *Documentos*.
- Pendiente (en pausa): emisión electrónica de boletas y facturas desde la app vía OSE/PSE; `documents` ya tiene
  `sunat_status` y `external_id`.

## Cierre de caja (`/caja`)

- Por **caja** (Ferretería / Copias) y **turno** (mañana / tarde) de un día. Sin monto de apertura:
  **efectivo esperado = ventas en efectivo − gastos** pagados con el efectivo de esa caja.
- **Gastos** (`cash_expenses`): monto + en qué; se registran en el turno abierto. Con el turno cerrado no se agregan
  ni quitan (trigger): hay que reabrirlo.
- **Cerrar** (`close_cash`, security definer): el servidor suma todas las ventas completadas de esa caja/turno/día
  (hora de Lima) de cualquier usuario y guarda una foto en `cash_closures` (por medio de pago, gastos, esperado,
  contado y diferencia: sobra / falta). Un cierre por caja+día+turno. No deja cerrar si este equipo tiene ventas
  de ese turno sin sincronizar.
- Si después se anula una venta, el cierre no cambia y la pantalla avisa que las ventas cambiaron. **Reabrir**
  (solo admin) borra el cierre para volver a cerrar. Historial de los últimos 30 días abajo.

## Reportes (`/reportes`, solo admin)

- Rango de fechas (desde/hasta, ambos inclusive, en hora local) con atajos: hoy, ayer, últimos 7 días, este mes, mes pasado.
- Filtros por turno, medio de pago y cajero. Total, número de ventas, ticket promedio, anuladas y **margen estimado**
  (solo con las líneas que tienen costo registrado al vender, `sale_items.unit_cost`; se indica qué % de las ventas cubre).
- Filtro por caja. Medio de pago, categoría, tabla caja × turno, ventas por día y caja y productos más vendidos (por categoría).
- **Exportar CSV**: una fila por línea de venta (incluye anuladas con su estado), UTF-8 con BOM para Excel.
- Las consultas paginan de a 1000 ventas (límite de PostgREST), así que sirven para rangos largos.

## Actividad (`/actividad`, solo admin)

Bitácora de quién hizo qué y cuándo (`activity_log`, migración `20261028000000_activity_log`). La llenan **triggers**
de la base, así queda todo lo que cambia, venga del POS, del celular o de SQL directo:

- **Ventas**: registrada (al confirmar la transacción, con el total final; las ventas offline, al sincronizar) y anulada.
- **Productos**: creado, editado (solo los campos que cambiaron, antes → después; categoría y proveedor por nombre),
  foto subida o quitada, costo cambiado a mano y eliminado. Los cambios de `stock` no cuentan: los mueven las ventas,
  compras y ajustes, que tienen su propia línea.
- **Compras**: orden creada, enviada, recibida (entró al stock), cancelada y eliminada.
- **Stock**: ajuste de un producto o conteo físico (una línea por conteo, con la diferencia y el stock final de cada producto).

Cada línea guarda el usuario (`auth.uid()`, o el cajero de la venta) y su nombre al momento; sin usuario se muestra
*Sistema*. Las cargas de Claude (`/facturas`, `/stock`) fijan `app.origen = 'claude'` y salen marcadas «vía Claude».
Solo el admin la lee (RLS) y nadie la escribe desde la API: solo los triggers. Filtros por fecha, tipo, usuario y texto.

## Historial de Firebase (app de impresiones)

Las 184 ventas de `/index.html` (25/09 – 07/10/2026) están importadas en `sales` con `legacy_ref` = id de Firebase
(migración `20261009150000_legacy_firebase_import`). Productos del catálogo antiguo → servicios `IMP-0xx`;
impresiones/fotocopias "Personalizado" → `IMP-900`; "Otros" → ítems libres. Todas en la caja *Copias y librería*
(`20261009160000_legacy_import_caja`), sin movimientos de stock; recibieron los números de venta 23–206.
"Yo"/"Hermano" se asignan con `legacy_user_map`. `import_legacy_sales(jsonb)` sigue disponible (solo admin) por si
hiciera falta reimportar desde el respaldo final de Firebase (13/10/2026, guardado fuera del repo): las ya importadas se omiten.

## Caja Copias y librería: secciones y servicios nuevos

- La caja *Copias y librería* tiene dos secciones: **Copias e impresiones** (servicios por hoja/unidad, sin stock) y
  **Librería** (artículos con stock, categoría *Librería*; catálogo inicial `LIB-001…013` con los precios que se
  cobraban como ítem libre, marcados *por revisar* para cargar costo y stock). Al buscar se busca en toda la caja.
- **Nuevo servicio** (admin y cajero): tarjeta en *Copias e impresiones* y botón en cada trabajo del panel 🖨️ (precarga
  tipo y color del trabajo). Tipo fotocopia / impresión / otro, nombre, precio por hoja o unidad, B/N-color, doble cara y
  palabras clave. Lo crea la RPC `create_copy_service` (security definer): solo servicios sin stock en Fotocopias o
  Impresiones, SKU `IMP-0xx` siguiente, así el cajero no necesita permiso general sobre `products`.
- **Nuevo artículo** de librería: admin/almacén (alta rápida con categoría Librería).

## Impresiones y copias (POS)

- Productos de las categorías *Fotocopias* e *Impresiones* son **servicios** (`track_stock = false`): se venden por hoja y no
  descuentan stock (`create_sale` no genera movimientos para ellos). En Inventario se marcan con *Servicio (no lleva stock)*.
- Botón 🖨️ en Ventas: trabajos que detecta el agente local (`http://localhost:4000`). Se reparten las hojas entre los
  productos (columnas `job_sources`, `job_color`, `job_duplex`, `job_keywords`; se editan en la sección
  *Trabajos detectados* del producto), con precio editable solo para esa venta; las hojas sin asignar quedan pendientes.
- Lógica en `features/print/`: `core.ts` (qué productos ofrecer por trabajo, reparto de hojas), `agent.ts` (cliente
  del agente, pendientes en localStorage) y `adapter.ts` (traduce `products` a la forma de `core.ts`).
- El agente debe permitir el dominio de Vercel en `localServer.allowedOrigin` (ver `collector-agent/README.md`).

## Offline (POS)

`checkout()` guarda la venta en Dexie con un UUID generado en el cliente y `flushOutbox()` la envía con la
RPC `create_sale`, que es idempotente por ese UUID: reintentar nunca duplica ventas ni descuenta stock dos veces.

## Despliegue (Vercel)

Vercel → *Add New Project* → importar el repo → **Root Directory: `web`** → Deploy.
`vercel.json` fija build/salida y evita que `sw.js` quede cacheado (actualizaciones de la PWA).
Luego agregar el dominio de Vercel en Supabase → Authentication → URL Configuration (*Site URL*).
