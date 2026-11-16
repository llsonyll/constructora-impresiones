# Etiquetas de precio

Pantalla de la app que genera hojas A4 con etiquetas de precio para imprimir y pegar en los
productos. Vive en `/inventario/etiquetas` (roles: admin, almacén).

No hay HTML externo ni PDF guardado — se genera en el momento desde los precios actuales
del catálogo.

## Formatos disponibles

| Código | Grilla | Etiquetas/hoja | Tamaño etiqueta | Presentaciones máx. | Cuándo usarlo |
|--------|--------|-----------------|-----------------|---------------------|---------------|
| `ancha` | 2 × 6 | 12 | 97 × 47 mm | 3 | Productos con nombre corto o 3 presentaciones |
| `angosta` | 3 × 6 | 18 | 65 × 47 mm | 2 | Nombres largos, productos medianos |
| `chica` | 5 × 6 | 30 | 39 × 47 mm | 2 | Productos pequeños, lotes grandes |

El formato elegido se guarda en `localStorage` (`etiquetas-formato`).

## Qué muestra cada etiqueta

- Nombre del negocio (cabecera pequeña)
- Nombre del producto (se achica automáticamente si es largo)
- Marca (solo si no está incluida en el nombre)
- Presentaciones con cantidad y precio por presentación
- **Precio principal** grande con símbolo S/ y unidad (c/u, el metro, el kilo…)
- SKU en tipografía monoespaciada
- Si el producto no tiene precio: línea en blanco para escribir a mano
- Líneas punteadas de corte entre etiquetas

No muestra stock, costo ni datos internos.

## Cómo imprimir

1. Ir a `/inventario/etiquetas`.
2. Buscar productos por nombre, SKU o ubicación (también funciona con lector de código de barras USB).
3. Ajustar la cantidad de copias con − / + (máx. 50 por producto).
4. Elegir el formato de hoja.
5. `Imprimir` → en el diálogo del navegador:
   - Destino: **Guardar como PDF** o impresora directa
   - Escala: **100 %** (no "ajustar a página")
   - Márgenes: **Ninguno**
   - Desmarcar encabezados y pies de página

## Persistencia de la lista

La lista de productos y copias se guarda en `localStorage` (`etiquetas-lista`).
Se mantiene entre recargas y se sincroniza entre pestañas del mismo equipo.
No se sincroniza entre dispositivos distintos.

## Archivos relevantes

| Archivo | Qué hace |
|---|---|
| `web/src/features/labels/labels.ts` | Tipos, formatos y funciones de reparto (`paginate`) |
| `web/src/features/labels/LabelsPage.tsx` | Pantalla completa + render de hojas |
| `web/src/features/labels/queue.ts` | Persistencia en localStorage |
| `web/src/features/labels/labels.test.ts` | Pruebas de reparto y textos |

## Qué cambiar si algo varía

| Cambio | Dónde |
|---|---|
| Agregar o modificar un formato | `FORMATS` en `labels.ts` |
| Cambiar qué aparece en la etiqueta | Componente `PriceLabel` en `LabelsPage.tsx` |
| Cambiar tamaño de hoja o márgenes de impresión | `@page` en `index.css` (líneas ~62–108) |
| Cambiar máximo de copias (50) | Constante en `LabelsPage.tsx` |
