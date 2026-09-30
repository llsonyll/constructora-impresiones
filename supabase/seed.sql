insert into categories (name) values
  ('Herramientas'), ('Electricidad'), ('Gasfitería'), ('Pinturas'), ('Ferretería general'),
  ('Construcción'), ('Librería'), ('Impresión y fotocopia')
on conflict do nothing;

-- Para crear el primer admin: registra un usuario en Auth y luego ejecuta:
--   update profiles set role = 'admin', active = true where id = '<uuid-del-usuario>';
