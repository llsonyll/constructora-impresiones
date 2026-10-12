-- Cierre de caja por caja (ferretería / copias) y turno. No hay monto de apertura:
--   efectivo esperado = ventas en efectivo − gastos pagados con el efectivo de esa caja.
-- El cierre guarda una foto de los totales (si después se anula una venta, el cierre no cambia).
-- Día = fecha en hora de Lima (Perú no tiene horario de verano).

-- Gastos esporádicos pagados con el efectivo de una caja (delivery, limpieza, etc.).
create table cash_expenses (
  id          bigint generated always as identity primary key,
  caja        caja not null,
  day         date not null default (now() at time zone 'America/Lima')::date,
  shift       shift_type not null,
  amount      numeric(12,2) not null check (amount > 0),
  description text not null check (length(trim(description)) > 0),
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now()
);
create index cash_expenses_day_idx on cash_expenses (day, caja, shift);
create index cash_expenses_user_idx on cash_expenses (created_by);

create table cash_closures (
  id            bigint generated always as identity primary key,
  caja          caja not null,
  day           date not null,
  shift         shift_type not null,
  sales_count   int not null,
  total_sales   numeric(12,2) not null,
  by_method     jsonb not null,                 -- {"efectivo": 120.5, "yape": 30, ...}
  cash_sales    numeric(12,2) not null,
  expenses      numeric(12,2) not null,
  expected_cash numeric(12,2) not null,         -- cash_sales − expenses
  counted_cash  numeric(12,2) not null check (counted_cash >= 0),
  difference    numeric(12,2) generated always as (counted_cash - expected_cash) stored,  -- + sobra, − falta
  note          text,
  closed_by     uuid not null default auth.uid() references auth.users(id),
  closed_at     timestamptz not null default now(),
  unique (caja, day, shift)
);
create index cash_closures_user_idx on cash_closures (closed_by);

-- Con el turno cerrado no se agregan, cambian ni quitan gastos (hay que reabrirlo primero).
create or replace function public.cash_expense_guard() returns trigger
language plpgsql set search_path = public as $$
declare r cash_expenses := coalesce(new, old);
begin
  if exists (select 1 from cash_closures c where c.caja = r.caja and c.day = r.day and c.shift = r.shift)
     or (tg_op = 'UPDATE' and exists (select 1 from cash_closures c where c.caja = old.caja and c.day = old.day and c.shift = old.shift)) then
    raise exception 'Ese turno ya está cerrado: reábrelo para cambiar sus gastos' using errcode = 'P0001';
  end if;
  return r;
end $$;
create trigger cash_expenses_guard before insert or update or delete on cash_expenses
  for each row execute function cash_expense_guard();

-- Cerrar: calcula los totales en el servidor (todas las ventas de esa caja y turno, de cualquier usuario).
create or replace function public.close_cash(p_caja caja, p_day date, p_shift shift_type, p_counted numeric, p_note text default null)
returns cash_closures
language plpgsql security definer set search_path = public as $$
declare
  v_methods jsonb;
  v_count   int;
  v_total   numeric;
  v_cash    numeric;
  v_exp     numeric;
  v_row     cash_closures;
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'Ingresa el efectivo contado';
  end if;
  if exists (select 1 from cash_closures where caja = p_caja and day = p_day and shift = p_shift) then
    raise exception 'Ese turno ya está cerrado';
  end if;

  select count(*), coalesce(sum(total), 0), coalesce(sum(total) filter (where payment_method = 'efectivo'), 0)
    into v_count, v_total, v_cash
    from sales
   where status = 'completada' and caja = p_caja and shift = p_shift
     and (sold_at at time zone 'America/Lima')::date = p_day;
  select coalesce(jsonb_object_agg(payment_method, t), '{}') into v_methods
    from (select payment_method, sum(total) t from sales
           where status = 'completada' and caja = p_caja and shift = p_shift
             and (sold_at at time zone 'America/Lima')::date = p_day
           group by payment_method) m;
  select coalesce(sum(amount), 0) into v_exp
    from cash_expenses where caja = p_caja and day = p_day and shift = p_shift;

  insert into cash_closures (caja, day, shift, sales_count, total_sales, by_method, cash_sales, expenses,
                             expected_cash, counted_cash, note)
  values (p_caja, p_day, p_shift, v_count, v_total, v_methods, v_cash, v_exp, v_cash - v_exp,
          p_counted, nullif(trim(p_note), ''))
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.close_cash(caja, date, shift_type, numeric, text) from public, anon;
grant execute on function public.close_cash(caja, date, shift_type, numeric, text) to authenticated;

-- RLS: gastos y cierres los ven y registran admin y cajero (el cierre solo por el RPC); reabrir (borrar el
-- cierre) solo admin. Quitar un gasto: admin, o el cajero que lo registró.
alter table cash_expenses enable row level security;
alter table cash_closures enable row level security;
create policy cash_expenses_read   on cash_expenses for select to authenticated using ((select public.has_role('admin', 'cajero')));
create policy cash_expenses_insert on cash_expenses for insert to authenticated
  with check ((select public.has_role('admin', 'cajero')) and created_by = (select auth.uid()));
create policy cash_expenses_delete on cash_expenses for delete to authenticated
  using ((select public.has_role('admin')) or ((select public.has_role('cajero')) and created_by = (select auth.uid())));
create policy cash_closures_read   on cash_closures for select to authenticated using ((select public.has_role('admin', 'cajero')));
create policy cash_closures_delete on cash_closures for delete to authenticated using ((select public.has_role('admin')));
