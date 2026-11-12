-- Aplicada directo en Supabase el 30/10 (versión 20261030161452); se agrega al repo para que quede el historial.
alter type furniture_type add value if not exists 'techo';
alter type furniture_type add value if not exists 'panel';
alter type furniture_type add value if not exists 'colgador';
