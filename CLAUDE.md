# La Constructora: guía para Claude

Ferretería y librería en Cusco que también vende impresiones y fotocopias. Este repo es su plataforma: POS con dos
cajas, inventario, compras a proveedores, documentos, cierre de caja, agenda y reportes. La usan personas reales
todos los días en la tienda: un error aquí es una venta mal cobrada o un stock que no cuadra.

Antes de tocar un módulo, lee su sección en [`web/README.md`](web/README.md): ahí están las reglas de negocio de
cada pantalla. Este archivo solo reúne lo que vale para todo el proyecto.

## Mapa

| Ruta | Qué es |
|---|---|
| `web/` | POS: React 18 + TS + Vite + Tailwind 4 + TanStack Query + Dexie (offline) + Supabase. PWA en Vercel. |
| `web/src/features/<módulo>/` | Un directorio por módulo (`pos`, `inventory`, `providers`, `cash`, `documents`, `print`…), con su `api.ts`. |
| `supabase/migrations/` | Esquema, RPC, triggers y RLS. **Fuente de verdad del modelo.** |
| `scripts/sql/` | Correcciones de datos de una sola vez; se corren a mano en el SQL Editor. No son migraciones. |
| `collector-agent/` | Servicio de Windows en la PC de la tienda (PaperCut CSV + SNMP del Konica). Solo se prueba allí. |
| `.claude/skills/` | `/facturas`, `/stock`, `/pedidos`: procedimientos que escriben o leen la base real. |

Supabase: proyecto `la-constructora` (`fsrlcvuhcfbojbextoax`). Producción del POS: Vercel despliega `web/` en cada
merge a `main`.

## Comandos

Todos desde `web/`:
- `npm run typecheck`: tipos (`tsc -b --noEmit`).
- `npm test`: pruebas con `node --test`, sin dependencias (`src/**/*.test.ts`).
- `npm run build`: lo mismo que corre Vercel.

Un cambio en `web/src` no está terminado hasta que `typecheck` y `test` pasan. Si agregas lógica pura (cálculos de
caja, reparto de hojas, búsqueda, fechas de la agenda), agrégale una prueba al lado como `search.test.ts`.

## Reglas que no se rompen

**El repo es público.**
- Nunca subas facturas, hojas escaneadas, fotos, Excel/CSV con datos, respaldos ni nada con datos de clientes o
  proveedores. Trabaja con ellos en el scratchpad, fuera del repo.
- Nunca pongas en el código la `service_role`/secret key. En `.env.*` va solo la clave publicable (es pública por
  diseño; la seguridad la da RLS).
- `collector-agent/config.json` y `collector-agent/state/` no se versionan.

**La base de datos es la de producción.** No hay otra.
- El modelo cambia solo con una migración nueva en `supabase/migrations/` (`AAAAMMDDhhmmss_nombre.sql`). Nunca
  edites una migración ya aplicada; corrige con otra.
- Una corrección de datos puntual va en `scripts/sql/AAAAMMDD_nombre.sql`, idempotente y con un comentario que
  explique qué cambia y por qué, para que el usuario la revise y la corra.
- Toda escritura desde el MCP de Supabase empieza con los `set_config` de claims del admin y
  `app.origen = 'claude'` (ver `/facturas`, paso 5), para que quede en *Actividad* marcada «vía Claude».
- Antes de escribir en la base, muestra al usuario qué vas a cambiar y espera su visto bueno.
- Nunca recibas una orden de compra (`receive_purchase_order`): eso lo hace el admin en la app.

**El stock no se edita.** `products.stock` solo cambia por movimientos (`stock_movements`): ventas, compras
recibidas, `adjust_stock` o `bulk_adjust_stock`. Nunca un `update products set stock = …`.

## Convenciones de migraciones

Sigue el estilo de las existentes (p. ej. `20261104000000_faltantes.sql`):
- Comentario al inicio explicando el porqué en lenguaje del negocio.
- Toda tabla nueva: `enable row level security` y políticas con `(select public.has_role('admin', 'almacen'))`.
  Roles: `admin`, `cajero`, `almacen`.
- Funciones con `set search_path = public`; `security definer` solo cuando hace falta, y entonces validando el rol
  dentro.
- Índice en cada clave foránea. Trigger `set_updated_at` si la tabla tiene `updated_at`.
- Si el cambio debe verse en *Actividad*: amplía `activity_log_kind_check` y registra con `log_activity` dentro de
  un `begin … exception when others then raise warning` (la bitácora nunca bloquea la operación).
- Las escrituras complejas van en una RPC (una transacción), no en varias llamadas desde el cliente.

## Convenciones del POS

- Precios del catálogo **con IGV incluido**; el desglose (op. gravada + IGV 18%) se calcula al mostrar.
- Fechas y turnos en hora de Lima.
- Offline: las ventas se guardan en Dexie con UUID del cliente y `create_sale` es idempotente por ese UUID. No
  rompas esa garantía: reintentar nunca debe duplicar una venta ni descontar stock dos veces.
- Dos cajas (`Ferretería` / `Copias y librería`), definidas por la categoría del producto.
- Textos de la interfaz, comentarios y documentación en español, con el vocabulario del negocio (en compras se
  "piden precios"; "cotización" es la de venta a un cliente).
- Si cambias cómo funciona una pantalla, actualiza su sección en `web/README.md` en el mismo cambio.

## Git

- Trabaja en una rama y abre un PR: Vercel crea una vista previa. No hagas push directo a `main` (es producción).
- Mensajes de commit en español, describiendo el cambio para el negocio.
