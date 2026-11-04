-- Agenda: fechas importantes del negocio en un calendario.
--   servicio       pago mensual de luz, agua, internet, alquiler…
--   pedido         recepción de pedidos y materiales (opcional: proveedor y orden de compra)
--   pago           cuotas de préstamos, facturas por pagar
--   mantenimiento  visitas técnicas de la fotocopiadora y la impresora
--   otro
-- Un evento puede repetirse (cada N semanas, meses o años, hasta una fecha o sin fin). Las fechas de cada vez
-- se calculan en la app; `agenda_occurrences` guarda solo lo que pasó en una fecha concreta: hecho/pagado
-- (con el monto real) o cambiada de día (`moved_to`, p. ej. el técnico vino otro día).

create table agenda_events (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('servicio', 'pedido', 'pago', 'mantenimiento', 'otro')),
  title             text not null check (length(trim(title)) > 0),
  start_date        date not null,                                         -- primera (o única) fecha
  repeat_unit       text check (repeat_unit in ('week', 'month', 'year')), -- null = una sola vez
  repeat_every      smallint not null default 1 check (repeat_every between 1 and 24),
  repeat_until      date check (repeat_until is null or repeat_until >= start_date),
  amount            numeric(12,2) check (amount is null or amount >= 0),   -- monto estimado
  provider_id       uuid references providers(id) on delete set null,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  notes             text,
  created_by        uuid default auth.uid() references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index agenda_events_start_idx on agenda_events (start_date);
create index agenda_events_provider_idx on agenda_events (provider_id);
create index agenda_events_po_idx on agenda_events (purchase_order_id);
create index agenda_events_user_idx on agenda_events (created_by);
create trigger agenda_events_updated before update on agenda_events
  for each row execute function set_updated_at();

-- Lo que pasó en una fecha del evento (`occurrence` = la fecha calculada, aunque se haya movido).
create table agenda_occurrences (
  event_id   uuid not null references agenda_events(id) on delete cascade,
  occurrence date not null,
  moved_to   date,                                     -- se hizo / se hará otro día
  done_at    timestamptz,                              -- null = pendiente
  done_by    uuid references auth.users(id),
  amount     numeric(12,2) check (amount is null or amount >= 0),  -- monto pagado de verdad
  note       text,
  updated_at timestamptz not null default now(),
  primary key (event_id, occurrence)
);
create index agenda_occurrences_done_by_idx on agenda_occurrences (done_by);
create trigger agenda_occurrences_updated before update on agenda_occurrences
  for each row execute function set_updated_at();

-- Todos los roles ven y anotan (el cajero recibe al técnico, el almacén recibe pedidos). Editar o borrar
-- un evento: quien lo creó o el admin. Marcar hecho, deshacer o mover una fecha: cualquiera.
alter table agenda_events enable row level security;
alter table agenda_occurrences enable row level security;
create policy agenda_events_read   on agenda_events for select to authenticated
  using ((select public.has_role('admin', 'cajero', 'almacen')));
create policy agenda_events_insert on agenda_events for insert to authenticated
  with check ((select public.has_role('admin', 'cajero', 'almacen')) and created_by = (select auth.uid()));
create policy agenda_events_update on agenda_events for update to authenticated
  using ((select public.has_role('admin')) or ((select public.has_role('cajero', 'almacen')) and created_by = (select auth.uid())));
create policy agenda_events_delete on agenda_events for delete to authenticated
  using ((select public.has_role('admin')) or ((select public.has_role('cajero', 'almacen')) and created_by = (select auth.uid())));
create policy agenda_occurrences_all on agenda_occurrences for all to authenticated
  using ((select public.has_role('admin', 'cajero', 'almacen')))
  with check ((select public.has_role('admin', 'cajero', 'almacen')));

-- Al recibir una orden de compra, la recepción agendada para ella (de una sola vez) queda hecha.
create or replace function public.agenda_po_received() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'recibida' and old.status is distinct from 'recibida' then
    insert into agenda_occurrences (event_id, occurrence, done_at, done_by, amount, note)
    select e.id, e.start_date, now(), auth.uid(), nullif(new.total, 0), 'Recibida OC-' || lpad(new.number::text, 4, '0')
      from agenda_events e
     where e.purchase_order_id = new.id and e.repeat_unit is null
    on conflict (event_id, occurrence) do update
      set done_at = coalesce(agenda_occurrences.done_at, excluded.done_at),
          done_by = coalesce(agenda_occurrences.done_by, excluded.done_by),
          note    = coalesce(agenda_occurrences.note, excluded.note);
  end if;
  return new;
end $$;
revoke execute on function public.agenda_po_received() from public, anon, authenticated;
create trigger purchase_orders_agenda after update of status on purchase_orders
  for each row execute function agenda_po_received();
