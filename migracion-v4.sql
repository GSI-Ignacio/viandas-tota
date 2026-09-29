-- ============================================================
-- Migración v4 de la app de Viandas
--   · Entregas y comandas son dos cosas distintas:
--       - Entregas: las viandas de los packs y clientes fijos. Cada vianda es
--         una unidad (fit, normal, lo que sea) y descuenta 1 crédito.
--       - Comandas: pedidos particulares de la carta, con platos, guarnición y
--         precio. Tienen su propio estado (pendiente / entregada / cancelada) y
--         al entregarse descuentan del stock los productos de cada plato. No
--         usan créditos.
--   · Una sola unidad por día: "menús por día" (se suman las cenas).
--   · La carta: precio, categoría (Carnes, Pollo…) y guarnición en los menús.
--     Las guarniciones son productos del stock.
--   · Lo ya entregado no se toca: el historial y los créditos quedan igual.
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Requiere migracion-v3.sql. Se puede volver a correr sin problema.
-- ============================================================

begin;

/* ---------- la carta: precio, categoría y guarnición ---------- */
alter table menus add column if not exists precio numeric(12,2);
alter table menus add column if not exists categoria text not null default '';
alter table menus add column if not exists lleva_guarnicion boolean not null default false;
alter table productos add column if not exists es_guarnicion boolean not null default false;

/* ---------- comandas: pedidos particulares con estado propio ---------- */
alter table comandas add column if not exists guarnicion_id uuid references productos(id) on delete set null;
alter table comandas add column if not exists estado text not null default 'pendiente';
alter table comandas add column if not exists precio numeric(12,2);
alter table comandas add column if not exists entregada_at timestamptz;
alter table comandas add column if not exists entregada_por uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'comandas_estado_chk') then
    alter table comandas add constraint comandas_estado_chk check (estado in ('pendiente', 'entregada', 'cancelada'));
  end if;
end $$;
alter table movimientos add column if not exists comanda_id uuid references comandas(id) on delete cascade;
create index if not exists movimientos_comanda_idx on movimientos (comanda_id);

-- una línea por plato y guarnición (2 milanesas con puré y 1 con arroz son dos líneas)
drop index if exists comandas_linea_uq;
create unique index if not exists comandas_linea_uq2 on comandas (cliente_id, fecha, turno,
  coalesce(menu_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(guarnicion_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- la vista del stock vuelve a armarse para incluir las columnas nuevas de productos
drop view if exists productos_stock;
create view productos_stock with (security_invoker = true) as
  select p.*, coalesce((select sum(m.cantidad) from movimientos m where m.producto_id = p.id), 0) as stock
  from productos p;

/* ---------- entregas: vuelven a ser solo las viandas de los packs ---------- */
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
  if new.almuerzo = 'entregado' and new.cant_almuerzo is null then
    new.cant_almuerzo := case when tg_op = 'UPDATE' and old.almuerzo = 'entregado' and old.cant_almuerzo is not null
                              then old.cant_almuerzo else greatest(c.cant_almuerzo, 1) end;
  end if;
  if new.cena = 'entregado' and new.cant_cena is null then
    new.cant_cena := case when tg_op = 'UPDATE' and old.cena = 'entregado' and old.cant_cena is not null
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
    cant := case when n.almuerzo = 'entregado' then n.cant_almuerzo when o.almuerzo = 'entregado' then o.cant_almuerzo end;
    insert into entregas_log (user_id, entrega_id, cliente_id, cliente_nombre, fecha, turno, antes, despues, cantidad, actor_id, actor_email, actor_rol)
    values (coalesce(n.user_id, o.user_id), coalesce(n.id, o.id), coalesce(n.cliente_id, o.cliente_id), coalesce(v_nombre, ''),
            coalesce(n.fecha, o.fecha), 'almuerzo', o.almuerzo, n.almuerzo, cant, auth.uid(), auth.jwt() ->> 'email', mi_rol());
  end if;
  if (o.cena is distinct from n.cena) then
    cant := case when n.cena = 'entregado' then n.cant_cena when o.cena = 'entregado' then o.cant_cena end;
    insert into entregas_log (user_id, entrega_id, cliente_id, cliente_nombre, fecha, turno, antes, despues, cantidad, actor_id, actor_email, actor_rol)
    values (coalesce(n.user_id, o.user_id), coalesce(n.id, o.id), coalesce(n.cliente_id, o.cliente_id), coalesce(v_nombre, ''),
            coalesce(n.fecha, o.fecha), 'cena', o.cena, n.cena, cant, auth.uid(), auth.jwt() ->> 'email', mi_rol());
  end if;

  -- solo lo que se usa en toda vianda (envases, cubiertos…)
  if tg_op <> 'DELETE' then
    delete from movimientos where entrega_id = n.id;
    if consumo_entrega(n) > 0 then
      insert into movimientos (user_id, producto_id, fecha, tipo, cantidad, nota, entrega_id, registrado_por)
      select n.user_id, p.id, n.fecha, 'entrega', -(p.por_vianda * consumo_entrega(n)), coalesce(v_nombre, ''), n.id, auth.uid()
      from productos p
      where p.user_id = n.user_id and p.activo and p.por_vianda > 0;
    end if;
  end if;
  return null;
end $$;

-- ya no hay comandas automáticas (la función queda para versiones viejas de la app)
create or replace function generar_comandas(p_fecha date) returns integer
language sql stable as $$ select 0 $$;

/* ---------- validación de comandas ---------- */
create or replace function comandas_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rol text := mi_rol();
  c clientes%rowtype;
  r comandas;
begin
  -- los borrados en cascada (al eliminar un cliente) no se validan
  if pg_trigger_depth() > 1 then return case when tg_op = 'DELETE' then old else new end; end if;
  if rol is null then raise exception 'Tenés que iniciar sesión'; end if;
  if rol = 'cadete' then raise exception 'Tu usuario no puede modificar comandas'; end if;
  foreach r in array (case when tg_op = 'INSERT' then array[new] when tg_op = 'DELETE' then array[old] else array[old, new] end) loop
    select * into c from clientes where id = r.cliente_id;
    if not found or c.user_id <> mi_negocio() then raise exception 'Cliente inexistente'; end if;
    if rol = 'ayudante' and r.fecha < hoy_ar() then raise exception 'Solo se pueden cargar comandas de hoy en adelante'; end if;
  end loop;
  -- un pedido entregado no se modifica: primero hay que volverlo a pendiente
  if tg_op = 'DELETE' and old.estado = 'entregada' then
    raise exception 'Ese pedido ya se entregó: volvelo a pendiente antes de borrarlo';
  end if;
  if tg_op = 'UPDATE' and old.estado = 'entregada'
     and (new.estado = 'entregada' or (new.cliente_id, new.fecha, new.turno, new.menu_id, new.guarnicion_id, new.cantidad)
                                        is distinct from (old.cliente_id, old.fecha, old.turno, old.menu_id, old.guarnicion_id, old.cantidad)) then
    raise exception 'Ese pedido ya se entregó: volvelo a pendiente antes de cambiarlo';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  new.user_id := c.user_id;
  if new.menu_id is not null and not exists (select 1 from menus m where m.id = new.menu_id and m.user_id = c.user_id) then
    raise exception 'Menú inexistente';
  end if;
  if new.guarnicion_id is not null and not exists (select 1 from productos p where p.id = new.guarnicion_id and p.user_id = c.user_id) then
    raise exception 'Guarnición inexistente';
  end if;
  if tg_op = 'INSERT' then
    new.registrado_por := auth.uid();
    if new.precio is null then new.precio := (select m.precio from menus m where m.id = new.menu_id); end if;
  end if;
  if new.estado = 'entregada' and (tg_op = 'INSERT' or old.estado <> 'entregada') then
    new.entregada_at := now(); new.entregada_por := auth.uid();
  elsif new.estado <> 'entregada' then
    new.entregada_at := null; new.entregada_por := null;
  end if;
  return new;
end $$;

/* ---------- al entregar un pedido: se descuentan sus productos y la guarnición ---------- */
create or replace function comandas_despues() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then delete from movimientos where comanda_id = old.id; end if;
  if tg_op in ('INSERT', 'UPDATE') and new.estado = 'entregada' then
    insert into movimientos (user_id, producto_id, fecha, tipo, cantidad, nota, comanda_id, registrado_por)
    select new.user_id, x.producto_id, new.fecha, 'entrega', -sum(x.cant),
           'Pedido de ' || coalesce((select nombre from clientes where id = new.cliente_id), ''), new.id, auth.uid()
    from (
      select mp.producto_id, new.cantidad * mp.cantidad as cant from menu_productos mp where mp.menu_id = new.menu_id
      union all
      select new.guarnicion_id, new.cantidad where new.guarnicion_id is not null
      union all
      select p.id, p.por_vianda * new.cantidad from productos p where p.user_id = new.user_id and p.activo and p.por_vianda > 0
    ) x
    join productos p on p.id = x.producto_id and p.activo
    group by x.producto_id;
  end if;
  return null;
end $$;

/* ---------- datos: una sola unidad "menús por día" (una vez) ---------- */
do $$
begin
  if exists (select 1 from app_migraciones where nombre = 'v4') then return; end if;

  update clientes
     set cant_almuerzo = cant_almuerzo + cant_cena,
         menu_almuerzo_id = coalesce(menu_almuerzo_id, menu_cena_id),
         cant_cena = 0,
         menu_cena_id = null,
         consumo = 'almuerzo'
   where cant_cena > 0 or menu_cena_id is not null or consumo = 'almuerzo_cena';

  insert into app_migraciones (nombre) values ('v4');
end $$;

/* ---------- datos: separar las comandas de las entregas (una vez) ---------- */
do $$
begin
  if exists (select 1 from app_migraciones where nombre = 'v4-pedidos') then return; end if;
  -- Las reglas de comandas piden un usuario con sesión: acá corre el administrador.
  alter table comandas disable trigger comandas_validar;

  -- las comandas automáticas eran una copia de las entregas de los packs: ya no hacen falta
  delete from comandas where origen = 'automatica';
  -- las cenas que quedaban pasan al menú del día (si coincide el plato, se suman)
  update comandas a set cantidad = a.cantidad + c.cantidad, nota = concat_ws(' · ', nullif(a.nota, ''), nullif(c.nota, ''))
    from comandas c
   where c.turno = 'cena' and a.turno = 'almuerzo' and a.cliente_id = c.cliente_id and a.fecha = c.fecha
     and a.menu_id is not distinct from c.menu_id and a.guarnicion_id is not distinct from c.guarnicion_id;
  delete from comandas c using comandas a
   where c.turno = 'cena' and a.turno = 'almuerzo' and a.cliente_id = c.cliente_id and a.fecha = c.fecha
     and a.menu_id is not distinct from c.menu_id and a.guarnicion_id is not distinct from c.guarnicion_id;
  update comandas c set turno = 'almuerzo'
   where c.turno = 'cena'
     and not exists (select 1 from comandas a where a.turno = 'almuerzo' and a.cliente_id = c.cliente_id and a.fecha = c.fecha
                       and a.menu_id is not distinct from c.menu_id and a.guarnicion_id is not distinct from c.guarnicion_id);
  -- estado de los pedidos que ya se habían registrado como entrega
  update comandas c set estado = 'entregada', entregada_at = e.updated_at
    from entregas e
   where e.cliente_id = c.cliente_id and e.fecha = c.fecha
     and ((c.turno = 'almuerzo' and e.almuerzo = 'entregado') or (c.turno = 'cena' and e.cena = 'entregado'));
  update comandas c set estado = 'cancelada'
    from entregas e
   where c.estado = 'pendiente' and e.cliente_id = c.cliente_id and e.fecha = c.fecha
     and ((c.turno = 'almuerzo' and e.almuerzo = 'saltado') or (c.turno = 'cena' and e.cena = 'saltado'));
  update comandas c set precio = m.precio from menus m where m.id = c.menu_id and c.precio is null;

  alter table comandas enable trigger comandas_validar;
  insert into app_migraciones (nombre) values ('v4-pedidos');
end $$;

drop trigger if exists comandas_validar on comandas;
create trigger comandas_validar before insert or update or delete on comandas
  for each row execute function comandas_validar();
drop trigger if exists comandas_despues on comandas;
create trigger comandas_despues after insert or update or delete on comandas
  for each row execute function comandas_despues();

commit;
