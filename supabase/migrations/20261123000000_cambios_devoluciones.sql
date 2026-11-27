-- Cambios y devoluciones. Un cliente devuelve un producto y se lleva otro (codo PVC 1/2 por codo hidro 1/2, que
-- cuesta distinto) o simplemente lo devuelve. Hasta ahora la única salida era anular la venta entera y volver a
-- cobrar todo: se perdían las demás líneas, cambiaba el total de un día ya cerrado y solo lo podía hacer el admin.
--
-- Un cambio es una venta nueva, en la caja y el turno en que ocurre, con las líneas devueltas en negativo y
-- enlazadas a la línea de la venta original (sale_items.returns_item_id):
--     CODO PVC 1/2 · devuelto de venta #1234   −1 × S/ 1.50
--     CODO HIDRO 1/2                           +1 × S/ 3.00     → el cliente paga S/ 1.50
-- La venta original no se toca (ni su día ni su cierre de caja); su línea anota cuánto se devolvió (returned_qty).
-- Total negativo = se le devuelve dinero al cliente, con el medio de pago de la venta. Así el cierre de caja, Hoy,
-- Reportes y el margen (subtotal − unit_cost × qty) quedan netos sin cambiar sus cálculos.
--
-- Reglas (en create_sale, en el servidor):
--   · Lo devuelto va al precio, presentación y costo de la venta original, no al precio actual del catálogo.
--   · Solo de una venta completada, de la misma caja, hasta 7 días después (fechas de Lima) y sin pasar lo que
--     queda por devolver. Las líneas devueltas de un ticket son todas de una misma venta.
--   · El cajero registra cambios (el ticket lleva al menos un producto nuevo); una devolución sin cambio, solo el admin.
--   · El stock vuelve con un movimiento 'devolucion' y la cantidad vuelve a su ubicación.
-- Anular un cambio (admin) lo deshace todo; una venta con un cambio vigente no se anula hasta anular el cambio.
-- create_sale sigue siendo idempotente por el UUID del cliente: un cambio guardado sin internet se reintenta sin
-- duplicarse ni devolver stock dos veces.

-- ---------- Modelo ----------
alter table sales add column if not exists returns_sale_id uuid
  constraint sales_returns_sale_id_fkey references sales(id);
create index if not exists sales_returns_sale_idx on sales (returns_sale_id);
comment on column sales.returns_sale_id is
  'Cambio o devolución: venta de la que se devuelven productos (sus líneas devueltas van en negativo).';

alter table sale_items add column if not exists returns_item_id bigint
  constraint sale_items_returns_item_id_fkey references sale_items(id);
alter table sale_items add column if not exists returned_qty numeric(12,3) not null default 0;
create index if not exists sale_items_returns_item_idx on sale_items (returns_item_id);
comment on column sale_items.returns_item_id is 'Línea devuelta: línea de la venta original (qty negativa).';
comment on column sale_items.returned_qty is 'Cuánto de esta línea ya se devolvió en cambios vigentes.';

-- Cantidades negativas solo en líneas devueltas; total negativo solo en un cambio o devolución.
alter table sale_items drop constraint if exists sale_items_qty_check;
alter table sale_items add constraint sale_items_qty_check
  check ((returns_item_id is null and qty > 0) or (returns_item_id is not null and qty < 0));
alter table sale_items drop constraint if exists sale_items_returned_qty_check;
alter table sale_items add constraint sale_items_returned_qty_check
  check (returned_qty >= 0 and (returned_qty = 0 or returned_qty <= qty));
alter table sales drop constraint if exists sales_total_check;
alter table sales add constraint sales_total_check check (total >= 0 or returns_sale_id is not null);

-- ---------- create_sale ----------
-- Igual que antes (presentaciones) + líneas devueltas (`returns_item_id`, `qty` de lo devuelto). De esas líneas
-- solo se toman el id y la cantidad: producto, descripción, precio, factor y costo salen de la venta original.
create or replace function public.create_sale(p_sale jsonb) returns sales
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := (p_sale->>'id')::uuid;
  v_sale   sales;
  v_item   jsonb;
  v_total  numeric(12,2) := 0;
  v_qty    numeric;
  v_price  numeric;
  v_cost   numeric;
  v_track  boolean;
  v_factor numeric;
  v_ret    bigint;
  v_orig   sale_items;
  v_osale  sales;
  v_new    int;
  v_back   int;
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado para registrar ventas' using errcode = '42501';
  end if;

  select * into v_sale from sales where id = v_id;
  if found then return v_sale; end if;

  if jsonb_array_length(coalesce(p_sale->'items', '[]')) = 0 then
    raise exception 'La venta no tiene ítems';
  end if;

  select count(*) filter (where nullif(i->>'returns_item_id', '') is null),
         count(*) filter (where nullif(i->>'returns_item_id', '') is not null)
    into v_new, v_back
    from jsonb_array_elements(p_sale->'items') i;
  if v_back > 0 and v_new = 0 and not public.has_role('admin') then
    raise exception 'Solo el administrador registra devoluciones sin cambio: agrega el producto que se lleva el cliente'
      using errcode = '42501';
  end if;

  insert into sales (id, cashier_id, shift, payment_method, total, customer_name,
                     customer_doc, note, sold_at, caja)
  values (v_id, auth.uid(), (p_sale->>'shift')::shift_type,
          (p_sale->>'payment_method')::payment_method, 0,
          nullif(p_sale->>'customer_name',''), nullif(p_sale->>'customer_doc',''),
          nullif(p_sale->>'note',''), coalesce((p_sale->>'sold_at')::timestamptz, now()),
          coalesce(nullif(p_sale->>'caja','')::caja, 'ferreteria'))
  returning * into v_sale;

  for v_item in select * from jsonb_array_elements(p_sale->'items') loop
    v_ret := nullif(v_item->>'returns_item_id', '')::bigint;

    -- ---- Línea devuelta ----
    if v_ret is not null then
      select * into v_orig from sale_items where id = v_ret;
      if not found then raise exception 'La línea devuelta no existe'; end if;
      -- Bloquea la venta original: dos cambios a la vez sobre ella no devuelven más de lo vendido.
      select * into v_osale from sales where id = v_orig.sale_id for update;
      select * into v_orig from sale_items where id = v_ret;   -- returned_qty al día, ya con el bloqueo
      if v_sale.returns_sale_id is null then
        update sales set returns_sale_id = v_osale.id where id = v_id returning * into v_sale;
      elsif v_sale.returns_sale_id <> v_osale.id then
        raise exception 'Un cambio solo puede devolver productos de una misma venta';
      end if;
      if v_osale.status <> 'completada' then
        raise exception 'La venta #% está anulada: no admite cambios', v_osale.number;
      end if;
      if v_orig.qty <= 0 then raise exception 'Esa línea ya es una devolución'; end if;
      if v_osale.caja <> v_sale.caja then
        raise exception 'Lo devuelto de la venta #% va en la caja %', v_osale.number,
          case v_osale.caja when 'copias' then 'Copias y librería' else 'Ferretería' end;
      end if;
      if v_sale.sold_at < v_osale.sold_at
         or (v_sale.sold_at at time zone 'America/Lima')::date
            - (v_osale.sold_at at time zone 'America/Lima')::date > 7 then
        raise exception 'La venta #% tiene más de 7 días: ya no admite cambios ni devoluciones', v_osale.number;
      end if;
      v_qty := -abs(coalesce((v_item->>'qty')::numeric, 0));
      if v_qty = 0 then raise exception 'Cantidad devuelta inválida en «%»', v_orig.description; end if;
      if -v_qty > v_orig.qty - v_orig.returned_qty then
        raise exception 'De «%» (venta #%) quedan % por devolver', v_orig.description, v_osale.number,
          trim_scale(v_orig.qty - v_orig.returned_qty);
      end if;

      update sale_items set returned_qty = returned_qty - v_qty where id = v_ret;
      insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, subtotal, factor,
                              returns_item_id)
      values (v_id, v_orig.product_id, v_orig.description || ' · devuelto de venta #' || v_osale.number, v_qty,
              v_orig.unit_price, v_orig.unit_cost, round(v_qty * v_orig.unit_price, 2), v_orig.factor, v_ret);
      -- Vuelve al stock solo lo que se descontó al vender (los servicios no tienen movimientos).
      if v_orig.product_id is not null and exists (
           select 1 from stock_movements
            where sale_id = v_osale.id and product_id = v_orig.product_id and reason = 'venta') then
        insert into stock_movements (product_id, qty, reason, sale_id)
        values (v_orig.product_id, -(v_qty * v_orig.factor), 'devolucion', v_id);
      end if;
      v_total := v_total + round(v_qty * v_orig.unit_price, 2);
      continue;
    end if;

    -- ---- Línea vendida ----
    v_qty    := (v_item->>'qty')::numeric;
    v_price  := (v_item->>'unit_price')::numeric;
    v_factor := coalesce(nullif(v_item->>'factor', '')::numeric, 1);
    if v_qty is null or v_qty <= 0 then raise exception 'Cantidad inválida en «%»', v_item->>'description'; end if;
    if v_factor <= 0 then raise exception 'Presentación inválida en «%»', v_item->>'description'; end if;
    v_cost  := null;
    v_track := false;
    if v_item->>'product_id' is not null then
      select cost into v_cost from product_costs where product_id = (v_item->>'product_id')::uuid;
      select track_stock into v_track from products where id = (v_item->>'product_id')::uuid;
    end if;

    insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, subtotal, factor)
    values (v_id, nullif(v_item->>'product_id','')::uuid, v_item->>'description',
            v_qty, v_price, v_cost * v_factor, round(v_qty * v_price, 2), v_factor);

    if coalesce(v_track, false) then
      insert into stock_movements (product_id, qty, reason, sale_id)
      values ((v_item->>'product_id')::uuid, -(v_qty * v_factor), 'venta', v_id);
    end if;

    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  update sales set total = v_total where id = v_id returning * into v_sale;
  return v_sale;
end $$;

-- ---------- void_sale ----------
-- Repone lo vendido y retira lo devuelto. Anular un cambio devuelve a la venta original lo que quedaba por devolver.
-- Una venta con un cambio vigente no se anula: primero se anula el cambio (si no, lo devuelto volvería dos veces).
create or replace function public.void_sale(p_sale_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sale   sales;
  v_change bigint;
begin
  if not public.has_role('admin') then
    raise exception 'Solo un administrador puede anular ventas' using errcode = '42501';
  end if;
  select * into v_sale from sales where id = p_sale_id for update;
  if not found or v_sale.status <> 'completada' then return; end if;

  select s.number into v_change
    from sale_items r join sales s on s.id = r.sale_id
   where s.status = 'completada'
     and r.returns_item_id in (select id from sale_items where sale_id = p_sale_id)
   order by s.number limit 1;
  if v_change is not null then
    raise exception 'La venta #% tiene un cambio o devolución (venta #%): anula primero ese cambio',
      v_sale.number, v_change;
  end if;

  update sales set status = 'anulada', voided_at = now(), voided_by = auth.uid() where id = p_sale_id;

  if v_sale.returns_sale_id is not null then
    perform 1 from sales where id = v_sale.returns_sale_id for update;
    update sale_items o set returned_qty = greatest(o.returned_qty + r.qty, 0)   -- r.qty es negativa
      from (select returns_item_id, sum(qty) qty from sale_items
             where sale_id = p_sale_id and returns_item_id is not null group by returns_item_id) r
     where o.id = r.returns_item_id;
  end if;

  insert into stock_movements (product_id, qty, reason, sale_id)
  select m.product_id, -m.qty, 'anulacion_venta', p_sale_id
    from stock_movements m where m.sale_id = p_sale_id and m.reason in ('venta', 'devolucion');
end $$;

-- ---------- Buscar la venta de la que se devuelve ----------
-- El cajero solo lee sus ventas (RLS), pero el cliente puede volver en otro turno: esta búsqueda muestra las ventas
-- de los últimos 7 días de cualquier cajero que todavía tienen algo por devolver. Por número (`1234` o `#1234`) o
-- por producto (todas las palabras en una línea, sin importar tildes). Las 20 más recientes.
create or replace function public.sales_for_return(p_search text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q     text := trim(coalesce(p_search, ''));
  v_num   bigint;
  v_words text[];
begin
  if not public.has_role('admin', 'cajero') then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_q ~ '^#?[0-9]{1,15}$' then
    v_num := ltrim(v_q, '#')::bigint;
  elsif v_q <> '' then
    v_words := regexp_split_to_array(translate(lower(v_q), 'áéíóúüñ', 'aeiouun'), '\s+');
  end if;

  return coalesce((
    select jsonb_agg(x.j order by x.sold_at desc)
      from (select s.sold_at, jsonb_build_object(
                     'id', s.id, 'number', s.number, 'sold_at', s.sold_at, 'caja', s.caja, 'total', s.total,
                     'payment_method', s.payment_method, 'customer_name', s.customer_name,
                     'cashier_name', (select nullif(full_name, '') from profiles where id = s.cashier_id),
                     'items', (select jsonb_agg(jsonb_build_object(
                                        'id', i.id, 'product_id', i.product_id, 'description', i.description,
                                        'qty', i.qty, 'unit_price', i.unit_price, 'factor', i.factor,
                                        'returned_qty', i.returned_qty) order by i.id)
                                 from sale_items i where i.sale_id = s.id and i.qty > 0)) j
              from sales s
             where s.status = 'completada'
               and (now() at time zone 'America/Lima')::date - (s.sold_at at time zone 'America/Lima')::date <= 7
               and exists (select 1 from sale_items i where i.sale_id = s.id and i.qty > i.returned_qty)
               and (v_num is null or s.number = v_num)
               and (v_words is null or exists (
                     select 1 from sale_items i
                      where i.sale_id = s.id and i.qty > 0
                        and (select bool_and(translate(lower(i.description), 'áéíóúüñ', 'aeiouun') like '%' || w || '%')
                               from unnest(v_words) w)))
             order by s.sold_at desc
             limit 20) x), '[]'::jsonb);
end $$;
revoke execute on function public.sales_for_return(text) from public, anon;
grant  execute on function public.sales_for_return(text) to authenticated;

-- ---------- Ubicaciones ----------
-- Lo que vuelve (anulación, devolución) se repone en la primera ubicación con cantidad; lo que sale (venta, anular
-- un cambio) se descuenta primero de la principal. Antes se decidía por el motivo; ahora por el signo.
create or replace function public.apply_location_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_left numeric := -new.qty;   -- unidades base por descontar
  v_loc  record;
  v_take numeric;
begin
  if new.qty > 0 then
    update product_locations set qty = greatest(qty + new.qty, 0)
     where (product_id, location_id) = (
       select product_id, location_id from product_locations
        where product_id = new.product_id and qty is not null
        order by is_primary desc, created_at, location_id limit 1);
    return null;
  end if;

  for v_loc in select location_id, qty from product_locations
                where product_id = new.product_id and qty > 0
                order by is_primary desc, created_at, location_id
                for update loop
    exit when v_left <= 0;
    v_take := least(v_loc.qty, v_left);
    update product_locations set qty = qty - v_take
     where product_id = new.product_id and location_id = v_loc.location_id;
    v_left := v_left - v_take;
  end loop;
  return null;
end $$;

drop trigger if exists stock_movements_locations on stock_movements;
create trigger stock_movements_locations after insert on stock_movements
  for each row when (new.reason in ('venta', 'anulacion_venta', 'devolucion')) execute function apply_location_movement();

-- ---------- Actividad ----------
-- Un cambio se registra como «Cambio #1240 sobre la venta #1234 · S/ 1.50 · …» (o «Devolución #…» si no lleva
-- productos nuevos).
create or replace function public.log_sale_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v       sales;
  v_items int;
  v_orig  bigint;
begin
  begin
    select * into v from sales where id = new.id;
    if not found or v.legacy_ref is not null then return null; end if;   -- importación de la app antigua
    select count(*) into v_items from sale_items where sale_id = v.id;
    if v.returns_sale_id is not null then
      select number into v_orig from sales where id = v.returns_sale_id;
      -- Sin productos nuevos es una devolución (solo admin): se le devolvió el dinero al cliente.
      perform log_activity('venta', 'venta_cambio', v.id::text,
        format('%s #%s sobre la venta #%s · %s · %s · %s',
               case when exists (select 1 from sale_items where sale_id = v.id and qty > 0) then 'Cambio' else 'Devolución' end,
               v.number, v_orig, activity_money(v.total),
               case v.caja when 'copias' then 'Copias y librería' else 'Ferretería' end, initcap(v.payment_method::text)),
        jsonb_build_object('number', v.number, 'total', v.total, 'caja', v.caja, 'payment_method', v.payment_method,
                           'items', v_items, 'sold_at', v.sold_at, 'returns_sale_number', v_orig),
        v.cashier_id);
      return null;
    end if;
    perform log_activity('venta', 'venta_registrada', v.id::text,
      format('Venta #%s · %s · %s · %s', v.number, activity_money(v.total),
             case v.caja when 'copias' then 'Copias y librería' else 'Ferretería' end, initcap(v.payment_method::text)),
      jsonb_build_object('number', v.number, 'total', v.total, 'caja', v.caja, 'payment_method', v.payment_method,
                         'items', v_items, 'sold_at', v.sold_at, 'customer_name', v.customer_name),
      v.cashier_id);
    return null;
  exception when others then
    raise warning 'activity_log (log_sale_created): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
  return null;
end $$;
