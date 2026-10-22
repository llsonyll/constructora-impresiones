---
name: stock
description: Cargar hojas de stock escritas a mano (PDF escaneado o foto) al sistema de La Constructora — transcribe la hoja, la valida con el usuario, crea los productos que falten en el catálogo, registra las cantidades como conteo físico y asigna la ubicación en el estante. Usar cuando el usuario adjunte una hoja de inventario, conteo o stock anotada a mano, o pida "cargar/subir el stock" o "registrar un conteo".
---

# Cargar hojas de stock manuscritas

Objetivo: lo anotado en la hoja termina en Supabase (proyecto `fsrlcvuhcfbojbextoax`) como **conteo físico**
(`stock_movements` con motivo `ajuste`) sobre productos del catálogo, con su ubicación. A diferencia de
`/facturas`, aquí sí se escribe el stock, así que **nada se carga sin que el usuario valide la lectura**.

No subas las hojas al repositorio (es público). Trabaja con ellas en el scratchpad.

## 1. Leer la hoja

- Los escaneos de la Konica llegan como PDF de imagen sin texto, y `pdftoppm` no está instalado:
  ```bash
  pip install -q pymupdf
  python3 -I - <<'E'
  import pymupdf
  p = pymupdf.open('<pdf>')[0]
  p.set_rotation(270)          # si la hoja vino de costado (probar 90/270)
  w, h = p.rect.width, p.rect.height
  p.get_pixmap(dpi=170).save('<scratchpad>/stock/hoja.png')
  p.get_pixmap(dpi=300, clip=pymupdf.Rect(0, 0, w*0.5, h*0.6)).save('<scratchpad>/stock/zona1.png')
  E
  ```
  Mira la hoja entera y luego amplía cada lista por zonas. Las cantidades corregidas a mano (un número
  escrito sobre otro) son las que más se confunden.
- Si en el escaneo aparece un documento personal (DNI, carné, etc.), ignóralo: no lo transcribas ni lo cites.
- Empareja cantidades y nombres **por posición**, no solo por orden. Si hay más nombres que cantidades
  (o al revés), no lo resuelvas tú: márcalo como duda.
- Anota también el encabezado de cada grupo: tipo de producto, marca, presentación (1/8 GL, 1/4 GL…) y precio.

## 2. Validar con el usuario (obligatorio)

Muéstrale una tabla por grupo (cantidad, producto/color) con las dudas **en negrita**, y pregúntale
de una vez todo lo pendiente:
- las cantidades y los nombres dudosos;
- si los precios anotados son de **venta** o de **costo**;
- la marca, si no es clara;
- la **ubicación**: estante, nivel y casillero (ver paso 5).

No escribas nada en la base de datos hasta que confirme. Si en su respuesta corrige solo algunas líneas,
las demás quedan como las leíste, pero en el resumen final dile cuáles diste por buenas sin que las confirmara.

## 3. Enlazar con el catálogo

```sql
select p.sku, p.name, p.unit, p.price, c.cost, p.stock, p.active
from products p left join product_costs c on c.product_id = p.id
where p.name ~* '(esmalte|crons)' order by p.name;
```
- Mismo producto = mismo tipo, marca, presentación y color. Si es el mismo artículo de otro proveedor,
  es el mismo producto (no se duplica por proveedor).
- Ante la duda, pregunta antes de crear un producto nuevo.

## 4. Productos nuevos

```sql
insert into products (sku, name, brand, category_id, unit, price, active, needs_review, notes) …
```
- **SKU**: prefijo de la categoría + siguiente número libre (`select max(sku) from products where sku like 'PIN-%'`):
  `PIN` Pinturas (4), `FER` Ferretería general (5), `HER` Herramientas (1), `ELE` Electricidad (2),
  `GAS` Gasfitería (3), `CON` Construcción (6). Entre paréntesis, el `category_id`.
- **Nombre**: en mayúsculas, como `TIPO MARCA PRESENTACIÓN COLOR`, para que queden agrupados al ordenar:
  `ESMALTE CRONS 1/8 GL NEGRO`, `ESMALTE ANYPSA 1/4 GL AMARILLO MD`. `brand` aparte.
- **Precio**: si el usuario confirmó que es de **venta** → `price = <valor>`, `active = true`.
  Si es costo, o no hay precio → `price = null`, `active = false` (lo pone el admin en *Inventario → Poner precios*).
  No inventes precios. No insertes en `product_costs`: el costo llega con la factura (`/facturas`).
- No envíes `stock`: el stock se carga en el paso siguiente.
- `notes`: `Alta desde hoja de stock manuscrita (<fecha>)`. `needs_review = true` solo en lo que quedó dudoso.

## 5. Stock y ubicación

El stock se carga como **conteo** con la RPC, que exige rol admin/almacén. Desde el MCP, actúa como
admin fijando los claims en la misma llamada (el admin principal es `sony_s07@hotmail.es`; su id se
obtiene con `select id from auth.users where email = …`):
```sql
select set_config('request.jwt.claims', '{"sub":"<uuid admin>","role":"authenticated"}', true);
select public.bulk_adjust_stock(
  (select jsonb_agg(jsonb_build_object('product_id', p.id, 'counted', v.qty))
     from (values ('PIN-0034', 9), ('PIN-0035', 6)) v(sku, qty) join products p on p.sku = v.sku),
  'Conteo físico esmaltes (hoja manuscrita 22/10/2026)');
```
- `counted` es la cantidad **total** que hay; la RPC registra la diferencia contra el stock actual.
  Una cantidad 0 también se envía (deja el stock en cero).
- Ubicación: `locations.code` sigue el formato `E4-N3-B` (estante E4, nivel 3, casillero B). Muchos niveles
  tienen casilleros A/B: si el usuario solo dijo estante y nivel, pregúntale cuál.
  ```sql
  insert into product_locations (product_id, location_id, is_primary)
  select id, (select id from locations where code = 'E4-N3-B'), true
  from products where sku between 'PIN-0034' and 'PIN-0053'
  on conflict do nothing;
  ```

Escribe con **sentencias cortas, una por llamada**. Las llamadas al MCP con varias escrituras, o con
`update … set notes = …` sobre varios productos, se han cancelado por superar los 60 s. Después de un
timeout, comprueba con un `select` si el cambio llegó a aplicarse antes de reintentar.

## 6. Verificar e informar

- Comprueba que la suma de unidades cargadas coincide con la de la hoja (por grupo y en total):
  ```sql
  select l.code, count(*) productos, sum(p.stock) unidades, count(*) filter (where p.needs_review) revisar
  from products p left join product_locations pl on pl.product_id = p.id left join locations l on l.id = pl.location_id
  where p.sku between '<desde>' and '<hasta>' group by l.code;
  ```
- Resumen al usuario: productos creados (rango de SKU) y los existentes que se enlazaron, unidades
  por grupo, ubicación, lo que quedó "por revisar" y si los productos quedaron activos (con precio) o no.
- Si los productos no tienen costo, recuérdale que se registra al cargar la factura del proveedor con `/facturas`.
