-- ============================================================
-- Migración v7 de la app de Viandas — "no lo recibió"
--   · Nuevo estado para una vianda de pack: el cadete fue y no la
--     recibieron, pero cuenta como vianda: usa el crédito y descuenta el
--     stock, igual que una entregada.
--   · "Saltear" sigue siendo lo de antes: ese día no recibe y no usa crédito.
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Requiere migracion-v5.sql. Se puede volver a correr sin problema.
-- ============================================================

begin;

/* ---------- lo que cuenta como vianda consumida ---------- */
create or replace function consumo_entrega(e entregas) returns integer
language sql immutable as $$
  select (case when e.almuerzo in ('entregado', 'no_recibido') then coalesce(e.cant_almuerzo, 1) else 0 end)
       + (case when e.cena in ('entregado', 'no_recibido') then coalesce(e.cant_cena, 1) else 0 end)
$$;

/* ---------- validación: también pide créditos y guarda la cantidad ---------- */
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
  if nuevo > viejo then
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

/* ---------- registro y stock: igual que una entregada ---------- */
create or replace function entregas_despues() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n entregas;
  o entregas;
  v_nombre text;
  cant integer;
begin
  if tg_op = 'DELETE' then n := null; o := old; else n := new; end if;
  if tg_op = 'UPDATE' then o := old; end if;
  select c.nombre into v_nombre from clientes c where c.id = coalesce(n.cliente_id, o.cliente_id);

  if (o.almuerzo is distinct from n.almuerzo) then
    cant := case when n.almuerzo in ('entregado', 'no_recibido') then n.cant_almuerzo when o.almuerzo in ('entregado', 'no_recibido') then o.cant_almuerzo end;
    insert into entregas_log (user_id, entrega_id, cliente_id, cliente_nombre, fecha, turno, antes, despues, cantidad, actor_id, actor_email, actor_rol)
    values (coalesce(n.user_id, o.user_id), coalesce(n.id, o.id), coalesce(n.cliente_id, o.cliente_id), coalesce(v_nombre, ''),
            coalesce(n.fecha, o.fecha), 'almuerzo', o.almuerzo, n.almuerzo, cant, auth.uid(), auth.jwt() ->> 'email', mi_rol());
  end if;
  if (o.cena is distinct from n.cena) then
    cant := case when n.cena in ('entregado', 'no_recibido') then n.cant_cena when o.cena in ('entregado', 'no_recibido') then o.cant_cena end;
    insert into entregas_log (user_id, entrega_id, cliente_id, cliente_nombre, fecha, turno, antes, despues, cantidad, actor_id, actor_email, actor_rol)
    values (coalesce(n.user_id, o.user_id), coalesce(n.id, o.id), coalesce(n.cliente_id, o.cliente_id), coalesce(v_nombre, ''),
            coalesce(n.fecha, o.fecha), 'cena', o.cena, n.cena, cant, auth.uid(), auth.jwt() ->> 'email', mi_rol());
  end if;

  -- lo que se usa en toda vianda (envases…) y los productos del tipo de vianda del cliente
  if tg_op <> 'DELETE' then
    delete from movimientos where entrega_id = n.id;
    if consumo_entrega(n) > 0 then
      insert into movimientos (user_id, producto_id, fecha, tipo, cantidad, nota, entrega_id, registrado_por)
      select n.user_id, x.producto_id, n.fecha, 'entrega', -sum(x.cant), coalesce(v_nombre, ''), n.id, auth.uid()
      from (
        select p.id as producto_id, p.por_vianda * consumo_entrega(n) as cant
          from productos p where p.user_id = n.user_id and p.activo and p.por_vianda > 0
        union all
        select mp.producto_id, mp.cantidad * consumo_entrega(n)
          from clientes c join menu_productos mp on mp.menu_id = c.menu_almuerzo_id where c.id = n.cliente_id
      ) x
      join productos p on p.id = x.producto_id and p.activo
      group by x.producto_id;
    end if;
  end if;
  return null;
end $$;

/* ---------- la app pregunta qué versión tiene la base ---------- */
create or replace function version_base() returns integer language sql immutable as $$ select 7 $$;
grant execute on function version_base() to authenticated;

-- que la API vea los cambios enseguida
notify pgrst, 'reload schema';

commit;
