-- Depósito: mercadería que no está en la ferretería. Va en su propio archivo porque un valor nuevo del enum
-- no se puede usar en la misma transacción en que se agrega (ver 20261115034607_deposito_d1.sql).
alter type furniture_type add value if not exists 'deposito';
