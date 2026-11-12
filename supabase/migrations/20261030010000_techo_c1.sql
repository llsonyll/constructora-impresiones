-- Aplicada directo en Supabase el 30/10 (versión 20261030180530); se agrega al repo para que quede el historial.
-- El 12/11 este techo pasó a R1 (ver 20261112000000_colgadores.sql): la C quedó para los colgadores.
insert into locations (furniture, level, slot, furniture_type, description) values
  ('C1', 1, 'A', 'techo', 'Cielo raso de tubos'),
  ('C1', 1, 'B', 'techo', 'Cielo raso de tubos'),
  ('C1', 1, 'C', 'techo', 'Cielo raso de tubos')
on conflict (code) do nothing;
