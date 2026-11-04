---
name: pedidos
description: Preparar un pedido a proveedor desde una lista escrita a mano (PDF escaneado o foto) para La Constructora — transcribe la hoja, genera el PDF de solicitud para enviar al proveedor y un PDF de cotejo con el catálogo de Supabase que indica qué productos ya están registrados, cuáles son parecidos (por confirmar) y cuáles no existen. Solo lee la base de datos. Usar cuando el usuario adjunte una lista de pedido, encargo o "posibles compras", o pida "armar/pasar en limpio un pedido", "hacer la solicitud al proveedor" o "cotejar el pedido con la base de datos".
---

# Pedidos a proveedores desde listas manuscritas

Objetivo: de una hoja de pedido escrita a mano salen dos PDF:
1. **Solicitud de pedido**: la lista tal como está en la hoja, en limpio, para enviar al proveedor (con columnas
   de precio en blanco para que la cotice). No lleva datos internos (stock, SKU, precios de venta).
2. **Cotejo con el catálogo**: uso interno. Cada línea con su estado (*Registrado*, *Por confirmar*, *No registrado*),
   el producto del catálogo, el stock y el precio de venta, las lecturas dudosas y la hoja original como anexo.

**No escribe en la base de datos**: un pedido todavía no es una compra. Cuando llegue la factura se carga con
`/facturas` (crea los productos que falten y la orden de compra en borrador).

No subas las hojas ni los PDF al repositorio (es público). Trabaja en el scratchpad (`<scratchpad>/pedido/`).

## 1. Leer la hoja

- Los escaneos de la Konica llegan como PDF de imagen sin texto, a veces girados. Si hay `pdftoppm`, úsalo; si no,
  `pip install -q pymupdf` (ver `/stock`).
  ```bash
  S=<scratchpad>/pedido; mkdir -p $S
  pdftoppm -r 200 -png <pdf> $S/raw            # una imagen por página: raw-1.png, raw-2.png…
  python3 -I - <<E
  from PIL import Image
  r = Image.open('$S/raw-1.png').rotate(90, expand=True)   # girar hasta que se lea derecho (90 / 270 / 0)
  r.save('$S/rot.png'); w, h = r.size
  r.resize((w//2, h//2)).save('$S/vista.png')               # vista general
  r.crop((0, 0, w//2, h//2)).save('$S/z1.png')              # luego zonas ampliadas
  r.convert('L').save('$S/anexo.jpg', quality=70)           # para el anexo del cotejo
  E
  ```
  Mira la vista general y luego **cada zona ampliada** con Read antes de transcribir.
- Si en el escaneo aparece un documento personal (DNI, carné…), ignóralo: no lo transcribas ni lo cites.
- Transcribe **en el orden y con la numeración de la hoja**. Las líneas sin número (otra columna, añadidos al
  margen) van después, numeradas en orden, y se dice en las dudas. Un renglón secundario escrito debajo de otro
  sin número propio va como `18-b`.
- Conserva lo que el cliente escribió: tipo, marca, medida, modelo, calidad ("económico"/"original", "premium")
  y cantidad con su presentación (cajas, paquetes, juegos, und). Corrige solo la ortografía evidente
  ("Termomagnetico" → "Termomagnético"); si un nombre es raro, déjalo como se lee y añade entre paréntesis
  lo que crees que es: `Tisibuks (Tisibook)`.
- Sin cantidad en la hoja → cantidad vacía (sale "—"). No inventes cantidades.
- El encabezado suele nombrar al proveedor ("Pedidos Sr. Diego Hnos."): búscalo en `providers` (paso 2).

### Revisión de un pedido ya generado

A veces el usuario imprime la **solicitud generada**, la anota a mano (cantidades al lado de los "—", correcciones
encima, marcas, productos nuevos al margen, recordatorios al pie) y la vuelve a escanear. En ese caso no es un
pedido nuevo: actualiza el `pedido.json` de ese proveedor (mismo scratchpad, si está en la sesión; si no,
transcribe la solicitud impresa como base).
- Asigna cada anotación a su renglón **por altura**, no por orden. Si cae entre dos renglones, elige el más
  cercano y anótalo en `dudas`.
- Lo que el usuario ya confirmó en el chat prevalece sobre lo impreso (la hoja puede ser una versión anterior).
- Detalles de una cantidad ("Cromado 3 / dorado 5") van en `detalle`; los productos nuevos se agregan al final
  con el número siguiente; un recordatorio ("ojo: preguntar por…") va a `notas_cotejo` y, si es para el
  proveedor, a `notas_solicitud`.
- Vuelve a cotejar solo las líneas nuevas o que cambiaron de descripción.
- En `anexo_imagen` pasa una lista con las dos hojas: la original y la revisión (ver paso 4).

## 2. Cotejar con el catálogo

Proyecto Supabase `fsrlcvuhcfbojbextoax`. Solo consultas `select`.

```sql
-- Proveedor
select name, ruc from providers where name ~* '(diego)';
-- Datos del negocio para el encabezado (si cambian, pasarlos en "negocio" del JSON)
select name, ruc, address, phone from business_info;
-- Candidatos: una expresión con las palabras clave de TODAS las líneas, incluyendo otros nombres
select p.sku, p.name, p.brand, p.unit, p.price, p.stock, p.active, array_to_string(p.aliases, ', ') aliases,
       pr.name prov
from products p left join providers pr on pr.id = p.provider_id
where p.name ~* '(termomag|supres|cable|enchuf|caja|valv|interrup|tomacorr|chapa|candado|linterna)'
   or array_to_string(p.aliases, ' ') ~* '(termomag|supres|cable)'
order by p.name;
-- Sinónimos compartidos (chapa = cerradura, toma = enchufe = tomacorriente…)
select terms from search_synonyms;
```
- Busca por **raíces cortas y sin tildes** (`termomag`, `interrup`, `v[aá]lvul`) y por sinónimos: la hoja dice
  "chapa" y el catálogo "CERRADURA"; "llave" puede ser termomagnético. Mira también los productos que ya tienen a
  ese proveedor (`provider_id`), que suelen ser los mismos artículos.
- Clasifica cada línea:
  - **registrado**: mismo tipo, medida/modelo y marca o calidad (o la hoja no precisa y solo hay uno).
  - **confirmar**: hay un producto muy parecido pero algo no cuadra o la hoja no lo precisa (calibre, medida,
    "original" = ¿qué marca?, marca escrita distinto: FORJE / FORTE). Pon en `obs` qué hay que confirmar.
  - **nuevo**: nada equivalente. Si hay algo parecido, menciónalo en `obs` ("Parecido: SKU NOMBRE").
  - Si una línea pide variantes (C32/C40/C63, doble y simple), cada variante es su propio producto.
- Señala lo que llame la atención: productos inactivos (`active = false`), sin precio o con stock negativo.

## 3. Validar con el usuario

Antes de generar los PDF definitivos, si hay lecturas dudosas que cambian el pedido (cantidades, medidas, una
palabra ilegible), muéstraselas en una lista corta y pregunta. Si el usuario pidió el resultado directamente,
genera los PDF con las dudas marcadas **(?)** y listadas en el cotejo, y pregúntaselas en el resumen.

## 4. Generar los PDF

Escribe `<scratchpad>/pedido/pedido.json` y ejecuta el generador de esta skill (solo necesita `reportlab` y Pillow):
```bash
python3 -I .claude/skills/pedidos/pedido_pdf.py <scratchpad>/pedido/pedido.json <scratchpad>/pedido/salida
```
Formato del JSON (los campos opcionales pueden omitirse):
```json
{
  "fecha": "2026-11-04",
  "numero": "opcional, p. ej. PED-2026-11-01",
  "proveedor": {"nombre": "GRUPO FERRETERO DIEGO & HNOS S.A.C.", "ruc": "20607956341",
                "corto": "diego_hnos", "contacto": "Sr. Diego"},
  "referencia": "Hoja manuscrita «Pedidos Sr. Diego Hnos.» (escaneo SKM_…)",
  "anexo_imagen": "<scratchpad>/pedido/anexo.jpg",
  "columna_precio": true,
  "saludo": "opcional: texto antes de la tabla de la solicitud",
  "notas_solicitud": ["Las líneas sin cantidad se coordinarán al confirmar la cotización."],
  "items": [
    {"n": "1", "descripcion": "Termomagnético económico C32", "cantidad": "3 cajas", "estado": "nuevo",
     "obs": "Solo existe NUE-0108 TERMOMAGNETICO BTICINO C32 (versión original)."},
    {"n": "2", "descripcion": "Cajas para termomagnético", "cantidad": "12 und", "duda": true,
     "estado": "registrado", "sku": "NUE-0056", "catalogo": "CAJA TERMOMAGNETICO SIMPLE",
     "stock": 1, "unidad": "und", "precio": 3.50, "inactivo": false,
     "detalle": "opcional: texto pequeño bajo la descripción (sale también en la solicitud)"}
  ],
  "dudas": ["Línea 2: se lee «12 un.» (el 1 está remarcado)."],
  "notas_cotejo": ["El proveedor ya existe en el sistema: …"]
}
```
- `estado`: `registrado` | `confirmar` | `nuevo`. `duda: true` marca la línea con **(?)** en el cotejo.
- `anexo_imagen` acepta una ruta o una lista (`["…/anexo.jpg", {"ruta": "…/revision.jpg", "titulo": "Anexo 2: revisión"}]`);
  cada imagen va en su propia página al final del cotejo.
- `negocio` (nombre, ruc, direccion, telefono) es opcional: por defecto usa los datos de `business_info`
  guardados en el script; si `business_info` cambió, pásalos en el JSON.
- Revisa el resultado antes de entregarlo: `pdftoppm -r 80 -png <pdf> <scratchpad>/pedido/prev` y mira las
  páginas. La solicitud debería caber en una hoja (el script achica la letra con más de 26 líneas, y más aún con más de 30).

## 5. Informe al usuario

Entrega las rutas completas de los dos PDF (en el scratchpad) y un resumen corto:
- cuántas líneas hay y cuántas están registradas / por confirmar / no registradas;
- tabla breve: N.°, pedido, estado, SKU del catálogo;
- las dudas de lectura, como preguntas concretas;
- siguientes pasos: confirmar las dudas, enviar la solicitud al proveedor y, cuando llegue la factura, cargarla
  con `/facturas` (crea los productos que falten). Si el usuario quiere dejar ya creados los productos nuevos
  (sin precio, inactivos), seguir los pasos 4 y 5 de `/facturas` solo con su confirmación explícita.
