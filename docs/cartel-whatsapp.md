# Cartel: envío de archivos por WhatsApp

Hoja A4 imprimible que guía a los clientes para enviar sus archivos al WhatsApp de la tienda.
Se imprime y se cuelga en los puntos de atención del local.

## Dónde viven los archivos

| Archivo | Ubicación |
|---|---|
| Fuente HTML | `~/Desktop/instrucciones-whatsapp.html` (fuera del repo, no se versiona) |
| PDF generado | Bucket de Supabase — subido manualmente por el admin |

> El HTML no entra al repo porque no es código de la app. El PDF no entra porque el repo es público
> y los assets de producción van en el bucket.

## Número de WhatsApp

```
+51 959 282 738
```

El enlace directo (abre chat sin guardar contacto):

```
https://wa.me/51959282738
```

Este enlace es el que codifica el código QR del cartel.

## Cómo regenerar el PDF

1. Abrir `~/Desktop/instrucciones-whatsapp.html` en **Chrome** (necesita internet para la fuente
   Poppins y el QR).
2. `Cmd + P` → destino **Guardar como PDF** → tamaño **A4** → márgenes **Ninguno** →
   desmarcar encabezados y pies de página.
3. Subir el PDF al bucket de Supabase de forma manual.

## Qué contiene el cartel

**4 pasos** (columna izquierda, 58 % del ancho):
1. Escanea el código QR
2. Adjunta tu archivo
3. Indica los detalles (copias, color, cara, tamaño)
4. ¡Listo! Te avisamos

**Columna derecha (42 %)** — jerarquía de contacto:
- Número de teléfono grande como elemento principal (la mayoría de clientes lo prefiere al QR)
- Botón "Abrir en WhatsApp"
- Separador "o escanea el QR"
- Código QR como opción secundaria

**Trabajos frecuentes** (franja inferior oscura):
Fotos de DNI · Récord de Conductor · Vouchers de pago · Formularios · Solicitudes · Denuncias · Impresiones en general

## Qué cambiar si algo varía

| Cambio | Qué editar en el HTML |
|---|---|
| Número de teléfono | `phone-country` + `phone-number` + parámetro `data=` de la URL del QR |
| Trabajos frecuentes | Bloque `.jobs-list` — cada `div.job-chip` |
| Texto de los pasos | Bloque `.steps-col` — `<strong>` y `<p>` de cada `.step` |
| Colores | Variables en `<style>`: `#25D366` (verde WhatsApp), `#0d2a1f` (fondo QR), `#1b2535` (fondo trabajos) |
