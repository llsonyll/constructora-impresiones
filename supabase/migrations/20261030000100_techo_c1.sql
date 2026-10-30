-- Cielo raso de tubos: un solo nivel dividido en sus 3 tramos (C1-N1-A, C1-N1-B, C1-N1-C), de izquierda a
-- derecha mirando desde donde se bajan los tubos.
insert into locations (furniture, level, slot, furniture_type, description) values
  ('C1', 1, 'A', 'techo', 'Cielo raso de tubos'),
  ('C1', 1, 'B', 'techo', 'Cielo raso de tubos'),
  ('C1', 1, 'C', 'techo', 'Cielo raso de tubos')
on conflict (code) do nothing;
