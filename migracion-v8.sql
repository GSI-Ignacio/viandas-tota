-- ============================================================
-- Migración v8 de la app de Viandas — créditos solo para los packs
--   · Pack de dietas: prepago. Sin créditos no se le entrega (como antes).
--   · Sanatorio y empresa: van a cuenta. Se les entrega aunque no tengan
--     créditos; lo que deben se cobra a fin de semana (en la app se ve en
--     amarillo) y al cargar el pago vuelve a cero.
--   · Casual: no usa créditos.
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Requiere migracion-v7.sql. Se puede volver a correr sin problema.
-- ============================================================

begin;

create or replace function entregas_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c clientes%rowtype;
  rol text := mi_rol();
  disponible bigint;
  nuevo integer;
  viejo integer := 0;
begin
  if rol is null then raise exception 'Tenés que iniciar sesión'; end if;
  -- Un upsert sobre una entrega que ya existe pasa primero por acá como INSERT y
  -- después como UPDATE: se valida en la pasada del UPDATE, que conoce la fila vieja.
  if tg_op = 'INSERT' and exists (select 1 from entregas x where x.cliente_id = new.cliente_id and x.fecha = new.fecha) then
    return new;
  end if;
  select * into c from clientes where id = new.cliente_id;
  if not found or c.user_id <> mi_negocio() then raise exception 'Cliente inexistente'; end if;
  new.user_id := c.user_id;

  if rol <> 'dueno' then
    if new.fecha <> hoy_ar() or (tg_op = 'UPDATE' and old.fecha <> new.fecha) then
      raise exception 'Solo se pueden registrar entregas del día de hoy';
    end if;
    if rol = 'cadete' and cadete_del_dia(new.cliente_id, new.fecha) is distinct from mi_cadete() then
      raise exception 'Este cliente no está en tu ruta de hoy';
    end if;
    new.cant_almuerzo := null;
    new.cant_cena := null;
  end if;

  -- cada vianda de la ficha del cliente es una unidad
  if new.almuerzo in ('entregado', 'no_recibido') and new.cant_almuerzo is null then
    new.cant_almuerzo := case when tg_op = 'UPDATE' and old.almuerzo in ('entregado', 'no_recibido') and old.cant_almuerzo is not null
                              then old.cant_almuerzo else greatest(c.cant_almuerzo, 1) end;
  end if;
  if new.cena in ('entregado', 'no_recibido') and new.cant_cena is null then
    new.cant_cena := case when tg_op = 'UPDATE' and old.cena in ('entregado', 'no_recibido') and old.cant_cena is not null
                          then old.cant_cena else greatest(c.cant_cena, 1) end;
  end if;

  nuevo := consumo_entrega(new);
  if tg_op = 'UPDATE' then viejo := consumo_entrega(old); end if;
  -- solo los packs de dietas son prepagos: sanatorios y empresas van a cuenta, y los casuales no usan créditos
  if nuevo > viejo and coalesce(c.tipo, 'casual') = 'pack' then
    disponible := saldo_cliente(new.cliente_id) + viejo;
    if nuevo > disponible then
      raise exception 'Sin créditos: a % le quedan % créditos. Cargá un pago antes de entregar.', c.nombre, greatest(disponible, 0);
    end if;
  end if;

  if new.cadete_id is null then new.cadete_id := cadete_del_dia(new.cliente_id, new.fecha); end if;
  new.registrado_por := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 8 $$;
grant execute on function version_base() to authenticated;

-- que la API vea los cambios enseguida
notify pgrst, 'reload schema';

commit;
