# Ferretería La Constructora — POS e inventario

Plataforma de la ferretería/librería que también ofrece impresiones y fotocopias: punto de venta con dos cajas
(Ferretería / Copias y librería), inventario, proveedores y compras, ventas del día y reportes, con captura
automática de los trabajos de impresión y copia desde un agente local.

**En producción:** https://web-five-kohl-92.vercel.app/

## Arquitectura

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ web/  POS (React + Vite,    │◄──────►│ Supabase (Postgres + Auth +  │
│ PWA offline) en Vercel      │  RLS   │ Storage): products, sales,   │
│ Ventas · Hoy · Reportes ·   │        │ purchase_orders, …           │
│ Inventario · Proveedores    │        └──────────────────────────────┘
└──────────────▲──────────────┘
               │ fetch http://localhost:4000/jobs (misma PC)
┌──────────────┴──────────────┐
│ collector-agent/ (Node.js)  │  PaperCut CSV (impresiones)
│ servicio de Windows         │  SNMP Konica (copias)
└─────────────────────────────┘
```

| Ruta | Contenido |
|---|---|
| `web/` | La aplicación. Ver su [README](web/README.md) (módulos, offline, despliegue). |
| `supabase/` | Migraciones SQL (fuente de verdad del modelo y de las reglas RLS). |
| `collector-agent/` | Agente local de captura de impresiones y copias. Ver su [README](collector-agent/README.md). |
| `scripts/` | Utilidades de carga de datos (catálogo desde Excel). |
| `.claude/skills/` | Procedimientos para Claude (p. ej. `facturas`: cargar facturas escaneadas como órdenes de compra). |
| `index.html` | Aviso de mudanza: redirige al POS a quien abra la antigua dirección de GitHub Pages. |

## Historia

Hasta el 07/10/2026 las impresiones y copias se registraban en una app de una sola página (`index.html` en
GitHub Pages, con Firebase). Sus 184 ventas se importaron a Supabase (`sales.legacy_ref`, ver `web/README.md`) y
la app se retiró; Firebase ya no se usa. La lógica de reparto de hojas que nació ahí vive ahora en
`web/src/features/print/`.

## Uso local

- POS: `cd web && npm install && npm run dev` (usa `web/.env.development`).
- Agente: seguir [`collector-agent/README.md`](collector-agent/README.md).

## Despliegue

- **POS**: Vercel despliega `web/` en cada merge a `main` (y una vista previa por PR).
- **Base de datos**: las migraciones de `supabase/migrations/` se aplican al proyecto de Supabase.
- **Agente**: copiar los archivos cambiados a la PC de la tienda y reiniciar el servicio `FerreteriaCollector`.
- GitHub Pages solo sirve el aviso de `index.html`.

## Seguridad

La clave publicable de Supabase viaja en el navegador por diseño; los datos se protegen con RLS y roles
(`admin`, `cajero`, `almacen`). `collector-agent/config.json` y `collector-agent/state/` no se versionan (ver
`.gitignore`). No subir facturas ni respaldos con datos de clientes al repositorio: es público.
