# Ferretería La Constructora — Registro de ventas

Aplicación web para registrar las ventas diarias de una ferretería/librería que también ofrece impresiones y fotocopias, con captura automática de trabajos de impresión desde un agente local.

**En producción:** https://llsonyll.github.io/constructora-impresiones/

## Qué resuelve

Reemplaza el cuaderno o Excel: registra ventas por turno (mañana/tarde), usuario y forma de pago (efectivo/Yape), y saca reportes. Las impresiones y copias se detectan solas para no tener que digitarlas.

## Funcionalidad

- **Registrar** — catálogo de productos con tarjetas +/−, ticket en vivo e ítem personalizado libre. Una columna en celular; dos columnas (ticket fijo a la derecha) desde 760px.
- **Hoy** — ventas del día con filtros por turno, usuario y pago; editar y eliminar.
- **Reportes** — filtros por fecha/turno/usuario/pago, subtotales por categoría, comparativo mañana/tarde y efectivo/Yape, exportación CSV, respaldo y restauración.
- **Productos** — CRUD del catálogo (crear, editar, desactivar, eliminar).
- **Comprobantes Yape** — foto opcional, comprimida y guardada como base64 dentro del documento de Firestore (sin Firebase Storage).
- **Integración con el agente** — indicador de estado 🟢/⚪/🔴, botón "Conectar agente de impresiones", aviso de trabajo nuevo y panel "Pendientes" para asignar el trabajo a una venta o ignorarlo.

## Arquitectura

```
┌────────────────────────────┐        ┌──────────────────────────┐
│ index.html (GitHub Pages)  │◄──────►│ Firebase Firestore       │
│ HTML + CSS + JS vanilla    │  Auth  │ trabajos, productos      │
│ sin build                  │ anónimo└──────────────────────────┘
└─────────────▲──────────────┘
              │ fetch http://localhost:4000 (/health, /jobs)
┌─────────────┴──────────────┐
│ collector-agent/ (Node.js) │  PaperCut CSV (impresiones)
│ servicio de Windows        │  SNMP Konica (copias)
└─────────────┬──────────────┘
              │ fetch http://localhost:4000 (/jobs)
┌─────────────▼──────────────┐        ┌──────────────────────────┐
│ web/ POS (Vercel, React)   │◄──────►│ Supabase                 │
│ panel 🖨️ de impresiones    │        │ products, sales (RPC)    │
└────────────────────────────┘        └──────────────────────────┘
```

Las dos apps conviven: **Firebase** sigue detrás de `index.html` y **Supabase** detrás del POS de `web/`.
La lógica de impresiones (pendientes del agente, qué productos ofrecer por trabajo, reparto de hojas)
está en `shared/print/` y la usan ambas; cada app solo adapta sus productos y guarda las ventas a su manera.
Cuando `index.html` se deje de usar, se retira Firebase y `shared/print/` pasa a `web/`.

| Ruta | Contenido |
|---|---|
| `index.html` | App de impresiones (HTML, CSS y JS inline). Firebase v10 compat por CDN. |
| `shared/print/` | Lógica de impresiones sin backend (`core.js`) y cliente del agente (`agent.js`), ES modules. |
| `web/` | Plataforma de la ferretería (POS, inventario) con Supabase. Ver su [README](web/README.md). |
| `supabase/` | Migraciones SQL de la plataforma. |
| `test-agente.html` | Página de prueba de conexión con el agente. |
| `collector-agent/` | Agente local de captura. Ver su [README](collector-agent/README.md). |

### Datos

- **`trabajos`** — ventas: `items`, `total`, turno, usuario, forma de pago, comprobante opcional.
- **`productos`** — catálogo de productos.
- Las reglas de Firestore validan `items`/`total` en `trabajos` y exigen autenticación para leer/escribir `productos`.
- Los pendientes del agente se guardan en `localStorage` del navegador.

## Uso local

No hay build ni dependencias para la app, pero importa `shared/print/` como ES module, así que hay que servirla (abrirla con `file://` no funciona): `python3 -m http.server` en la raíz y abrir `http://localhost:8000`.

Para el agente de impresiones, sigue las instrucciones de [`collector-agent/README.md`](collector-agent/README.md) (`npm install`, copiar `config.example.json` a `config.json`, `npm start` o instalar como servicio).

## Despliegue

GitHub Pages sirve directamente los archivos de la rama principal. El despliegue es manual: fusionar/subir los cambios a esa rama.

## Decisiones de diseño

- **Vanilla JS, sin framework:** adecuado al tamaño actual del proyecto. Si crece (multi-dispositivo, más pantallas, más desarrolladores) se evaluaría modularizar con módulos ES o migrar a Vite + Preact/Svelte.
- **Sin Firebase Storage:** los comprobantes van en base64 dentro de Firestore para no requerir el plan Blaze (límite de 1 MB por documento, de ahí la compresión).
- **Agente 100% local, sin Cloud Functions ni sincronización a Firestore:** no hay necesidad de acceso remoto ni multi-dispositivo por ahora. La app lo lee por `localhost` desde la misma PC.

## Seguridad

La configuración de Firebase del cliente es pública por diseño; los datos se protegen únicamente con las reglas de Firestore. Con Auth anónimo, cualquiera que conozca la URL puede usar la app, así que conviene no difundirla. `collector-agent/config.json` y `collector-agent/state/` no se versionan (ver `.gitignore`).
