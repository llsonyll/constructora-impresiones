-- Colgadores: barras de ángulo ranurado con ganchos donde cuelgan productos (rodillos, griferías, discos…),
-- independientes de los estantes. Son un mueble más con su propia letra: C1, C2… con un solo nivel (N1) y,
-- si la barra es larga, tramos de izquierda a derecha como secciones: C1-N1-A, C1-N1-B…
-- Así el formato del código no cambia y siguen sirviendo el buscador, reshape_furniture y las ventas.
-- En la app el N1 no se muestra y "C1-A" también encuentra C1-N1-A.

alter type furniture_type add value if not exists 'colgador';

-- Un colgador tiene un solo nivel y no tiene cuerpos. Se compara como texto porque el valor nuevo del enum
-- no se puede usar en la misma transacción en que se agrega.
alter table locations add constraint locations_colgador_shape
  check (furniture_type::text <> 'colgador' or (level = 1 and body is null));
