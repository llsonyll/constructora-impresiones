-- Corregir un mueble entero (o un cuerpo de mueble) de una vez: niveles, secciones por nivel, código y tipo.
-- Una sola transacción; nunca borra una ubicación con productos asignados (avisa cuál es).
-- SECURITY INVOKER: rigen las políticas RLS de locations (admin y almacén).
--
-- p = { furniture, body?, levels, slots, new_furniture?, furniture_type? }
--   levels = 0 → elimina el mueble (o cuerpo) completo.
--   slots  = 0 → niveles enteros (E7-N1); n > 0 → secciones A…(n) (E7-N1-A, E7-N1-B…).
-- Al pasar de secciones a nivel entero se conserva la primera sección (y sus productos) como el nivel entero;
-- al pasar de nivel entero a secciones, el nivel entero pasa a ser la sección A.
create or replace function public.reshape_furniture(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_f      text := upper(trim(p->>'furniture'));
  v_body   text := nullif(upper(trim(coalesce(p->>'body', ''))), '');
  v_levels int  := (p->>'levels')::int;
  v_slots  int  := (p->>'slots')::int;
  v_new    text := coalesce(nullif(upper(trim(coalesce(p->>'new_furniture', ''))), ''), upper(trim(p->>'furniture')));
  v_type   furniture_type := nullif(p->>'furniture_type', '')::furniture_type;
  v_max    int;
  v_keep   locations;
  v_loc    locations;
  v_letter text;
  v_created int := 0; v_deleted int := 0; v_updated int := 0;
begin
  if v_levels is null or v_levels < 0 or v_levels > 30 then raise exception 'Cantidad de niveles inválida (0 a 30)'; end if;
  if v_slots is null or v_slots < 0 or v_slots > 8 then raise exception 'Secciones por nivel inválidas (0 a 8)'; end if;
  select max(level) into v_max from locations where furniture = v_f and body is not distinct from v_body;
  if v_max is null then raise exception 'No existe el mueble %', v_f || coalesce('-' || v_body, ''); end if;

  for l in 1 .. greatest(v_levels, v_max) loop
    if l > v_levels then
      -- Nivel que sobra: se borran todas sus casillas (si están vacías).
      for v_loc in select * from locations where furniture = v_f and body is not distinct from v_body and level = l loop
        if exists (select 1 from product_locations where location_id = v_loc.id) then
          raise exception 'La ubicación % tiene productos: muévelos antes de quitarla', v_loc.code using errcode = '23503';
        end if;
        delete from locations where id = v_loc.id; v_deleted := v_deleted + 1;
      end loop;
    elsif v_slots = 0 then
      -- Nivel entero: se conserva la casilla sin sección o, si no hay, la primera sección.
      select * into v_keep from locations where furniture = v_f and body is not distinct from v_body and level = l
        order by slot nulls first limit 1;
      for v_loc in select * from locations where furniture = v_f and body is not distinct from v_body and level = l
                     and id <> coalesce(v_keep.id, -1) loop
        if exists (select 1 from product_locations where location_id = v_loc.id) then
          raise exception 'La ubicación % tiene productos: muévelos antes de quitarla', v_loc.code using errcode = '23503';
        end if;
        delete from locations where id = v_loc.id; v_deleted := v_deleted + 1;
      end loop;
      if v_keep.id is null then
        insert into locations (furniture, body, level, slot, furniture_type)
        values (v_f, v_body, l, null, coalesce(v_type, (select furniture_type from locations where furniture = v_f limit 1), 'estante'));
        v_created := v_created + 1;
      elsif v_keep.slot is not null then
        update locations set slot = null where id = v_keep.id; v_updated := v_updated + 1;
      end if;
      v_keep := null;
    else
      -- Con secciones: el nivel entero (si lo había) pasa a ser la A; se crean las que falten y se quitan las de más.
      select * into v_keep from locations where furniture = v_f and body is not distinct from v_body and level = l and slot is null;
      if v_keep.id is not null then
        if exists (select 1 from locations where furniture = v_f and body is not distinct from v_body and level = l and slot = 'A') then
          if exists (select 1 from product_locations where location_id = v_keep.id) then
            raise exception 'La ubicación % tiene productos: muévelos antes de dividir el nivel', v_keep.code using errcode = '23503';
          end if;
          delete from locations where id = v_keep.id; v_deleted := v_deleted + 1;
        else
          update locations set slot = 'A' where id = v_keep.id; v_updated := v_updated + 1;
        end if;
      end if;
      v_keep := null;
      for v_loc in select * from locations where furniture = v_f and body is not distinct from v_body and level = l
                     and slot > chr(ascii('A') + v_slots - 1) loop
        if exists (select 1 from product_locations where location_id = v_loc.id) then
          raise exception 'La ubicación % tiene productos: muévelos antes de quitarla', v_loc.code using errcode = '23503';
        end if;
        delete from locations where id = v_loc.id; v_deleted := v_deleted + 1;
      end loop;
      for i in 0 .. v_slots - 1 loop
        v_letter := chr(ascii('A') + i);
        if not exists (select 1 from locations where furniture = v_f and body is not distinct from v_body and level = l and slot = v_letter) then
          insert into locations (furniture, body, level, slot, furniture_type)
          values (v_f, v_body, l, v_letter, coalesce(v_type, (select furniture_type from locations where furniture = v_f limit 1), 'estante'));
          v_created := v_created + 1;
        end if;
      end loop;
    end if;
  end loop;

  if v_levels > 0 and (v_new <> v_f or v_type is not null) then
    update locations set furniture = v_new, furniture_type = coalesce(v_type, furniture_type)
     where furniture = v_f and body is not distinct from v_body;
  end if;

  return jsonb_build_object('creadas', v_created, 'eliminadas', v_deleted, 'modificadas', v_updated,
                            'mueble', v_new || coalesce('-' || v_body, ''));
end $$;

revoke execute on function public.reshape_furniture(jsonb) from public, anon;
grant  execute on function public.reshape_furniture(jsonb) to authenticated;
