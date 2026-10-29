---
name: facturas
description: Cargar facturas de proveedores escaneadas (PDF o foto) al sistema de La Constructora — crea los productos que falten en el catálogo y una orden de compra en borrador por factura, para que el admin la revise y la reciba en la app. Usar cuando el usuario adjunte facturas, boletas, notas de compra o cotizaciones de proveedores, o pida "cargar/registrar facturas" o "agregar productos desde facturas".
---

# Cargar facturas de proveedores

Objetivo: cada factura de compra termina como **orden de compra en borrador** en Supabase (proyecto
`fsrlcvuhcfbojbextoax`), con sus productos enlazados al catálogo. **Nunca la recibas tú**: el admin la revisa
en *Proveedores* y pulsa **Recibir**, que es lo que suma stock, guarda el costo en `product_cost_history`
(origen `compra`) y asigna el proveedor. Un borrador mal leído se corrige o borra sin efectos.

No subas las facturas al repositorio (es público). Trabaja con ellas en el scratchpad.

## 1. Leer los documentos

- Los escaneos de la Konica llegan como PDF de imagen sin texto, y `pdftoppm` no está instalado:
  ```bash
  pip install -q pymupdf
  python3 -I - <<'E'
  import pymupdf, sys, glob
  for f in glob.glob('<carpeta>/*.pdf'):
      for i, p in enumerate(pymupdf.open(f)):
          p.get_pixmap(dpi=170).save(f'<scratchpad>/facturas/{f.split("/")[-1][:-4]}_p{i+1}.png')
  E
  ```
  Luego mira cada PNG con Read. Una hoja escaneada puede traer **varios documentos** lado a lado.
- Clasifica cada documento:
  - **Factura / boleta / nota de venta del proveedor** → se carga.
  - **Cotización** → no es compra: no crear orden. Pregunta si se compró; si solo interesa el catálogo,
    crear los productos nuevos (sin stock) y anotar el costo cotizado en `notes`.
  - **Guía de envío / flete** (p. ej. Navitas) → no trae productos; solo mencionarla en el resumen.
- Por cada factura anota: proveedor y RUC, serie-número (`FE01-00052724`, `F003-5497`), fecha, y por línea:
  descripción tal cual, código del fabricante si aparece, cantidad, unidad, P/U y total.

## 2. IGV y unidades

- Comprueba si los precios **incluyen IGV**: si la suma de los totales por línea = TOTAL S/ (con IGV), el P/U
  incluye IGV → `costs_include_igv = true`. Si la suma da el "Op. Gravada/Sub Total" → sin IGV → `false`
  (la recepción multiplica por 1.18). Hasta ahora Valcosa y Punto Azul facturan con IGV incluido.
- El costo en el sistema es **por unidad de venta del producto**. Si la factura vende por caja, ciento o
  paquete y el producto se vende por unidad, convierte (cantidad × contenido, costo ÷ contenido) y déjalo
  explicado en `notes` (como "costo por und: PQT10 = 10"). Soldadura y similares van por `kg`.

## 3. Enlazar con el catálogo

Busca candidatos por palabras clave y por proveedor:
```sql
select p.sku, p.name, p.unit, p.price, c.cost, p.stock, p.active, pr.name prov
from products p left join product_costs c on c.product_id = p.id left join providers pr on pr.id = p.provider_id
where p.name ~* '(codo|tee|pvc)' or pr.name ilike 'valcosa%' order by p.name;
```
- Mismo producto = mismo tipo, medida, ángulo, línea (SAL/SAP/desagüe), marca. "CODO PVC SAL 90° X 2" **no** es
  "… X 3"; "TEE SANIT" (sanitaria) no es "TEE" simple. Ante la duda, producto nuevo con `needs_review = true`.
- Proveedor: por RUC o nombre en `providers`. Si no existe, créalo (name, ruc) antes de la orden.

## 4. Productos nuevos

```sql
insert into products (sku, name, brand, category_id, provider_id, unit, price, active, needs_review, notes) …
```
- Cada llamada que escribe empieza con los dos `set_config` del paso 5 (claims del admin y `app.origen`): así
  el alta queda en *Actividad* a nombre del admin y marcada «vía Claude».
- **SKU**: prefijo de la categoría + siguiente número libre (`select max(sku) from products where sku like 'GAS-%'`):
  `GAS` Gasfitería, `HER` Herramientas, `ELE` Electricidad, `CON` Construcción, `FER` Ferretería general,
  `PIN` Pinturas. Categorías de la caja *Copias y librería* (Librería, Fotocopias, Impresiones): sin prefijo
  propio → deja que la BD asigne `NUE-xxxx` (no envíes sku).
- **Nombre**: en mayúsculas como en la factura, normalizando espacios ("2 X2" → "2 X 2") y abreviaturas
  dudosas ("TEE SANIT" → "TEE SANITARIA", dejando el texto original en `notes`). `brand` si se ve (PAVCO, SOLDEXA…).
- `price = null`, `active = false`: el admin pone el precio en *Inventario → Poner precios* (sugiere precio
  por recargo sobre costo). No inventes precios de venta.
- `notes`: origen — `Factura <Proveedor> <serie-número> (<fecha>)` + código del fabricante si hay.
- `needs_review = true` si algo se leyó con duda (código poco legible, cantidad borrosa, nombre ambiguo).
- No insertes en `product_costs`: el costo lo pone la recepción de la orden.

## 5. Orden de compra en borrador

Las RPC exigen rol admin/almacén; desde el MCP de Supabase actúa como un admin fijando los claims en la
misma llamada (el admin principal es `sony_s07@hotmail.es`, ver `select id from auth.users where email = …`):
```sql
select set_config('request.jwt.claims', '{"sub":"<uuid admin>","role":"authenticated"}', true),
       set_config('app.origen', 'claude', true);
select public.save_purchase_order(jsonb_build_object(
  'provider_id', (select id from providers where name = 'VALCOSA INGS. S.R.L.'),
  'invoice_ref', 'FE01-00052724', 'costs_include_igv', true,
  'note', 'Factura del 24/09/2026 (cargada desde escaneo). Precios con IGV.',
  'items', jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where sku = 'GAS-0023'), 'qty', 50, 'unit_cost', 1.95))));
```
- Una orden por factura; antes, comprueba que no exista ya una con ese `invoice_ref` y proveedor.
- **Verifica** que `purchase_orders.total` coincida con el TOTAL de la factura (con IGV). Si no cuadra,
  revisa la lectura antes de seguir.
- No llames a `receive_purchase_order`.

## 6. Informe al usuario

Para cada documento: qué es, proveedor, número, total, líneas enlazadas (SKU) y productos creados; costos
que cambian respecto al catálogo (anterior → factura); lo que quedó "por revisar"; documentos no cargados
(cotizaciones, guías) y por qué. Recuérdale:
- Revisar y **Recibir** cada orden en *Proveedores* (número OC-000N).
- Si la factura es antigua y parte de la mercadería ya se vendió, recibir igual (registra costo e
  historial) y luego ajustar con un **Conteo de stock** de esos productos.
- Los productos nuevos quedan inactivos hasta que tengan precio.
