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

## Offline (POS)

`checkout()` guarda la venta en Dexie con un UUID generado en el cliente y `flushOutbox()` la envía con la
RPC `create_sale`, que es idempotente por ese UUID: reintentar nunca duplica ventas ni descuenta stock dos veces.

## Despliegue (Vercel)

Vercel → *Add New Project* → importar el repo → **Root Directory: `web`** → Deploy.
`vercel.json` fija build/salida y evita que `sw.js` quede cacheado (actualizaciones de la PWA).
Luego agregar el dominio de Vercel en Supabase → Authentication → URL Configuration (*Site URL*).
