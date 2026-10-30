-- Tres tipos de mueble más: el cielo raso donde se guardan los tubos (techo), el panel donde se cuelgan cosas
-- (panel) y los colgadores aéreos (colgador). Letra sugerida del código: C techo (T ya es el mostrador T1),
-- P panel, A colgador aéreo. Van solos en esta migración: un valor nuevo de enum no se puede usar en la misma
-- transacción en que se agrega.
alter type furniture_type add value if not exists 'techo';
alter type furniture_type add value if not exists 'panel';
alter type furniture_type add value if not exists 'colgador';
