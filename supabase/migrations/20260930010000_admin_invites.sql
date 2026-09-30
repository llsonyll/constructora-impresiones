-- Invitaciones de rol: si un correo invitado crea su cuenta, su perfil nace con ese rol y activo.
-- Tabla no expuesta: RLS activado sin políticas (solo SQL Editor / service role).
create table role_invites (
  email      text primary key check (email = lower(email)),
  role       user_role not null,
  created_at timestamptz not null default now()
);
alter table role_invites enable row level security;
revoke all on role_invites from anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role user_role;
begin
  select role into v_role from role_invites where email = lower(new.email);
  insert into profiles (id, full_name, role, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email, ''),
          coalesce(v_role, 'cajero'), v_role is not null);
  if v_role is not null then delete from role_invites where email = lower(new.email); end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Uso (SQL Editor): insert into role_invites (email, role) values ('correo@ejemplo.com', 'cajero');
