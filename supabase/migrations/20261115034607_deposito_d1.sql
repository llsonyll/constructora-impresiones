-- Depósito general: todo lo que no está en la ferretería. Por ahora no hay un depósito fijo, así que es una sola
-- ubicación general: D1 (código D1-N1, igual que los colgadores el N1 no se muestra en la app y "D1" la encuentra).
-- Más adelante se pueden agregar zonas como secciones (D1-N1-A, D1-N1-B…) u otro depósito (D2) sin cambiar el
-- formato del código, así siguen sirviendo el buscador, reshape_furniture y el descuento de ventas.

-- Como un colgador: un solo nivel y sin cuerpos.
alter table locations add constraint locations_deposito_shape
  check (furniture_type::text <> 'deposito' or (level = 1 and body is null));

insert into locations (furniture, level, furniture_type, description)
values ('D1', 1, 'deposito', 'Depósito general (fuera de la ferretería)')
on conflict (code) do nothing;
