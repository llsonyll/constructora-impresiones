-- Tickets abiertos compartidos. Hasta ahora cada equipo guardaba su ticket solo en su navegador: lo que armaba una
-- persona no lo veía nadie más. Ahora los tickets en curso viven aquí y los tres los ven en vivo (Realtime): cada uno
-- abre tickets para sus clientes y cualquiera puede continuarlos o cobrarlos.
--   abierto    → en curso; aparece en Ventas de todos los equipos.
--   cobrado    → se cobró: la venta tiene el MISMO id que el ticket (create_sale es idempotente por id, así que dos
--                personas cobrando el mismo ticket nunca crean dos ventas ni descuentan stock dos veces). Lo marca
--                el trigger de `sales` al llegar la venta, también si se cobró sin internet.
--   descartado → se borró sin cobrar (o se pasó a cotización).
-- Un ticket no reserva stock: el stock solo cambia con la venta.
-- Escritura solo por RPC (ticket_save, ticket_discard). `version` evita pisar cambios de otro equipo: quien guarda
-- con una versión vieja recibe un error y recarga el ticket.

create table open_tickets (
  id              uuid primary key,                     -- generado en el equipo; será el id de la venta
  caja            caja not null,
  label           text,                                 -- cliente o referencia opcional ("señor del casco")
  lines           jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  quote           jsonb,                                -- cotización que se está cobrando {id, label, customer_name, customer_doc}
  status          text not null default 'abierto' check (status in ('abierto', 'cobrado', 'descartado')),
  version         integer not null default 1,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_name text,
  updated_by      uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index open_tickets_status_idx     on open_tickets (status, caja, created_at);
create index open_tickets_created_by_idx on open_tickets (created_by);
create index open_tickets_updated_by_idx on open_tickets (updated_by);

create trigger open_tickets_updated before update on open_tickets
  for each row execute function set_updated_at();

alter table open_tickets enable row level security;
-- Los que venden (admin y cajero) ven todos los tickets: la idea es justamente compartirlos. Sin INSERT/UPDATE directo.
create policy open_tickets_read on open_tickets for select to authenticated
  using ((select public.has_role('admin', 'cajero')));

alter publication supabase_realtime add table open_tickets;

-- ---------- Guardar (crear o actualizar) ----------
-- p: {id, caja, label, lines, quote, expected_version}. expected_version = 0 → ticket nuevo (si ya existe con
-- versión 1 o más, es un conflicto). Errores: 'ticket_cerrado' (ya se cobró o descartó), 'ticket_conflicto'
-- (otro equipo lo cambió después de la versión que tiene este equipo).
create or replace function public.ticket_save(p jsonb) returns open_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_id       uuid := (p->>'id')::uuid;
  v_expected integer := coalesce((p->>'expected_version')::integer, 0);
  v_name     text := (select nullif(full_name, '') from profiles where id = auth.uid());
  v_row      open_tickets;
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado para manejar tickets' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p->'lines', '[]')) <> 'array' then raise exception 'Líneas inválidas'; end if;

  select * into v_row from open_tickets where id = v_id for update;
  if not found then
    if exists (select 1 from sales where id = v_id) then raise exception 'ticket_cerrado'; end if;
    insert into open_tickets (id, caja, label, lines, quote, created_by_name, updated_by_name)
    values (v_id, (p->>'caja')::caja, nullif(trim(p->>'label'), ''), coalesce(p->'lines', '[]'),
            nullif(p->'quote', 'null'::jsonb), v_name, v_name)
    returning * into v_row;
    -- Limpieza: los tickets cerrados solo sirven unos días (la venta ya guarda todo).
    delete from open_tickets where status <> 'abierto' and closed_at < now() - interval '7 days';
    return v_row;
  end if;

  if v_row.status <> 'abierto' then raise exception 'ticket_cerrado'; end if;
  if v_row.version <> v_expected then raise exception 'ticket_conflicto'; end if;

  update open_tickets
     set label = nullif(trim(p->>'label'), ''),
         lines = coalesce(p->'lines', '[]'),
         quote = nullif(p->'quote', 'null'::jsonb),
         version = version + 1,
         updated_by = auth.uid(),
         updated_by_name = v_name
   where id = v_id
  returning * into v_row;
  return v_row;
end $$;

-- ---------- Descartar ----------
-- Idempotente: descartar un ticket ya cerrado (o que nunca llegó al servidor) no hace nada.
create or replace function public.ticket_discard(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_row open_tickets;
begin
  if not public.has_role('admin', 'cajero') then
    raise exception 'No autorizado para manejar tickets' using errcode = '42501';
  end if;
  update open_tickets set status = 'descartado', closed_at = now(), version = version + 1,
         updated_by = auth.uid(), updated_by_name = (select nullif(full_name, '') from profiles where id = auth.uid())
   where id = p_id and status = 'abierto'
  returning * into v_row;
  if not found or jsonb_array_length(v_row.lines) = 0 then return; end if;
  begin
    perform log_activity('venta', 'ticket_descartado', v_row.id::text,
      format('Ticket descartado sin cobrar: %s ítem%s · %s%s',
             jsonb_array_length(v_row.lines), case when jsonb_array_length(v_row.lines) = 1 then '' else 's' end,
             activity_money((select coalesce(sum(round((l->>'qty')::numeric * (l->>'unit_price')::numeric, 2)), 0)
                               from jsonb_array_elements(v_row.lines) l)),
             coalesce(' · ' || v_row.label, '')),
      jsonb_build_object('caja', v_row.caja, 'lines', v_row.lines, 'created_by_name', v_row.created_by_name));
  exception when others then
    raise warning 'activity_log (ticket_discard): %', sqlerrm;   -- la bitácora nunca bloquea la operación
  end;
end $$;

-- ---------- Cobrado: lo cierra la venta ----------
create or replace function public.close_ticket_on_sale() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update open_tickets set status = 'cobrado', closed_at = now(), version = version + 1
   where id = new.id and status = 'abierto';
  return null;
end $$;
create trigger sales_close_ticket after insert on sales
  for each row execute function close_ticket_on_sale();

revoke execute on function public.ticket_save(jsonb)       from public, anon;
revoke execute on function public.ticket_discard(uuid)     from public, anon;
grant  execute on function public.ticket_save(jsonb)       to authenticated;
grant  execute on function public.ticket_discard(uuid)     to authenticated;
revoke execute on function public.close_ticket_on_sale()   from public, anon, authenticated;
