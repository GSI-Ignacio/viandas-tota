-- ============================================================
-- ACTUALIZAR LA BASE DE DATOS de la app de Viandas
--
-- Es el único archivo que hay que correr para dejar la base al día:
--   Supabase → SQL Editor → pegar todo → Run.
-- Se puede correr todas las veces que quieras: lo que ya está hecho no se
-- vuelve a hacer y no se tocan los datos.
--
-- Cada actualización nueva se agrega al final de este archivo.
-- Adentro van, en orden, las versiones 5 a 21. Las anteriores (v2 a v4) ya están corridas;
-- quedan en la carpeta migraciones/ como historial, junto con cada versión por separado.
-- ============================================================

-- ============================================================
-- Migración v5 de la app de Viandas
--   · Menú del día: para cada fecha se eligen qué platos de la carta son
--     los menús del día y qué guarniciones hay para acompañar.
--     Al cargar un pedido aparecen primero esos platos, y la guarnición se
--     elige entre las de ese día.
--   · El dueño lo elige para cualquier día; el ayudante, de hoy en adelante.
--   · Stock al momento: un pedido descuenta sus productos apenas se carga
--     (pendiente o entregado) y los devuelve si se cancela o se borra.
--     Una vianda de pack, al registrarse entregada, descuenta los envases y
--     los productos de su tipo de vianda. El stock puede quedar en negativo:
--     la app lo marca en rojo.
--   · Los pedidos pendientes de hoy en adelante que ya estaban cargados
--     descuentan su stock al correr esto (una sola vez).
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede volver a correr sin problema.
-- ============================================================

begin;

create table if not exists carta_dia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  fecha date not null,
  menu_id uuid references menus(id) on delete cascade,
  guarnicion_id uuid references productos(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint carta_dia_una_cosa check ((menu_id is null) <> (guarnicion_id is null))
);
create unique index if not exists carta_dia_menu_uq on carta_dia (user_id, fecha, menu_id) where menu_id is not null;
create unique index if not exists carta_dia_guarnicion_uq on carta_dia (user_id, fecha, guarnicion_id) where guarnicion_id is not null;
create index if not exists carta_dia_fecha_idx on carta_dia (user_id, fecha);

alter table carta_dia enable row level security;
drop policy if exists "leer" on carta_dia;
drop policy if exists "elegir" on carta_dia;
drop policy if exists "quitar" on carta_dia;
create policy "leer" on carta_dia for select using (user_id = mi_negocio());
create policy "elegir" on carta_dia for insert with check (
  user_id = mi_negocio() and (mi_rol() = 'dueno' or (mi_rol() = 'ayudante' and fecha >= hoy_ar())));
create policy "quitar" on carta_dia for delete using (
  user_id = mi_negocio() and (mi_rol() = 'dueno' or (mi_rol() = 'ayudante' and fecha >= hoy_ar())));
grant select, insert, delete on carta_dia to authenticated;

/* ---------- stock: los pedidos descuentan al cargarse ---------- */
create or replace function descontar_comanda(c comandas) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into movimientos (user_id, producto_id, fecha, tipo, cantidad, nota, comanda_id, registrado_por)
  select c.user_id, x.producto_id, c.fecha, 'entrega', -sum(x.cant),
         'Pedido de ' || coalesce((select nombre from clientes where id = c.cliente_id), ''), c.id, auth.uid()
  from (
    select mp.producto_id, c.cantidad * mp.cantidad as cant from menu_productos mp where mp.menu_id = c.menu_id
    union all
    select c.guarnicion_id, c.cantidad where c.guarnicion_id is not null
    union all
    select p.id, p.por_vianda * c.cantidad from productos p where p.user_id = c.user_id and p.activo and p.por_vianda > 0
  ) x
  join productos p on p.id = x.producto_id and p.activo
  group by x.producto_id;
end $$;
revoke execute on function descontar_comanda(comandas) from public, anon, authenticated;

create or replace function comandas_despues() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then delete from movimientos where comanda_id = old.id; end if;
  if tg_op in ('INSERT', 'UPDATE') and new.estado <> 'cancelada' then perform descontar_comanda(new); end if;
  return null;
end $$;

/* ---------- stock: la vianda de un pack descuenta también su tipo de vianda ---------- */
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

/* ---------- los pedidos pendientes que ya estaban cargados (una vez) ---------- */
do $$
declare r comandas;
begin
  if exists (select 1 from app_migraciones where nombre = 'v5-stock') then return; end if;
  for r in select * from comandas c where c.estado = 'pendiente' and c.fecha >= hoy_ar()
             and not exists (select 1 from movimientos m where m.comanda_id = c.id) loop
    perform descontar_comanda(r);
  end loop;
  insert into app_migraciones (nombre) values ('v5-stock');
end $$;

-- que la API vea la tabla nueva enseguida
notify pgrst, 'reload schema';

commit;


-- ============================================================
-- Migración v6 de la app de Viandas — un solo negocio para todos
--   · Se pueden sumar usuarios con acceso total ("Dueño"), además de
--     ayudantes y cadetes. Todos ven y cargan los mismos datos.
--   · Si la cuenta que se suma ya había cargado datos por su cuenta
--     (clientes, pagos, entregas, pedidos, stock, menús…), se pasan al
--     negocio compartido en vez de rechazarla.
--   · La configuración del negocio (nombre, cocina…) es la misma para todos.
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede volver a correr sin problema.
--
-- Para ver qué cargó cada cuenta:
--     select * from resumen_cuentas();
-- Para unir cuentas desde acá (la primera es la principal):
--     select unir_cuentas('principal@mail.com', array['sofia@mail.com', 'otra@mail.com']);
-- ============================================================

begin;

/* ---------- usuarios con acceso total ---------- */
alter table miembros drop constraint if exists miembros_rol_check;
alter table miembros add constraint miembros_rol_check check (rol in ('dueno', 'ayudante', 'cadete'));

/* ---------- mudar los datos de una cuenta a otro negocio ---------- */
create or replace function mover_negocio(origen uuid, destino uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if origen is null or destino is null or origen = destino then return; end if;
  -- es una mudanza: sin validaciones ni descuentos de stock
  alter table entregas disable trigger user;
  alter table comandas disable trigger user;
  -- todas las tablas que tienen dueño (user_id), salvo las que se juntan aparte
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
           where c.table_schema = 'public' and c.column_name = 'user_id' and tb.table_type = 'BASE TABLE'
             and c.table_name not in ('stock', 'negocio_config') loop
    execute format('update %I set user_id = $1 where user_id = $2', t) using destino, origen;
  end loop;
  -- producción diaria: si las dos cuentas cargaron el mismo día, se suman
  update stock d set preparadas = d.preparadas + o.preparadas
    from stock o where o.user_id = origen and d.user_id = destino and d.fecha = o.fecha;
  delete from stock o where o.user_id = origen and exists (select 1 from stock d where d.user_id = destino and d.fecha = o.fecha);
  update stock set user_id = destino where user_id = origen;
  -- configuración: queda la del negocio principal
  if exists (select 1 from negocio_config where user_id = destino) then
    delete from negocio_config where user_id = origen;
  else
    update negocio_config set user_id = destino where user_id = origen;
  end if;
  -- quienes eran del negocio de esa cuenta pasan al principal
  update miembros set negocio_id = destino where negocio_id = origen;
  alter table entregas enable trigger user;
  alter table comandas enable trigger user;
end $$;
revoke execute on function mover_negocio(uuid, uuid) from public, anon, authenticated;

/* ---------- sumar un usuario (desde Equipo en la app) ---------- */
create or replace function agregar_miembro(p_email text, p_rol text, p_nombre text default '', p_cadete_id uuid default null)
returns miembros
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
  neg uuid := mi_negocio();
  fila miembros;
begin
  if auth.uid() is null or mi_rol() <> 'dueno' then raise exception 'Solo el dueño puede sumar usuarios'; end if;
  if p_rol not in ('dueno', 'ayudante', 'cadete') then raise exception 'Rol inválido'; end if;
  if p_rol = 'cadete' and p_cadete_id is null then raise exception 'Elegí qué cadete es este usuario'; end if;
  if p_cadete_id is not null and not exists (select 1 from cadetes where id = p_cadete_id and user_id = neg) then
    raise exception 'Cadete inexistente';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No existe un usuario con el email %. Crealo primero en Supabase → Authentication → Users.', trim(p_email);
  end if;
  if uid = auth.uid() or uid = neg then raise exception 'Ese es tu propio usuario'; end if;
  if exists (select 1 from miembros where auth_id = uid and negocio_id <> neg) then
    raise exception 'Ese usuario ya pertenece a otro negocio';
  end if;
  -- si ya había cargado datos por su cuenta, se pasan a este negocio
  perform mover_negocio(uid, neg);
  insert into miembros (auth_id, negocio_id, email, nombre, rol, cadete_id)
  values (uid, neg, lower(trim(p_email)), coalesce(p_nombre, ''), p_rol, case when p_rol = 'cadete' then p_cadete_id end)
  on conflict (auth_id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol, nombre = excluded.nombre, cadete_id = excluded.cadete_id
  returning * into fila;
  return fila;
end $$;
revoke execute on function agregar_miembro(text, text, text, uuid) from public, anon;
grant execute on function agregar_miembro(text, text, text, uuid) to authenticated;

/* ---------- unir cuentas desde el SQL Editor ---------- */
create or replace function unir_cuentas(p_principal text, p_otros text[], p_rol text default 'dueno') returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  principal uuid;
  destino uuid;
  correo text;
  uid uuid;
  n integer := 0;
begin
  if p_rol not in ('dueno', 'ayudante') then raise exception 'Rol inválido: dueno o ayudante'; end if;
  select id into principal from auth.users where lower(email) = lower(trim(p_principal));
  if principal is null then raise exception 'No existe el usuario %', p_principal; end if;
  -- si la principal ya era parte de otro negocio, se une a ese
  destino := coalesce((select negocio_id from miembros where auth_id = principal), principal);
  foreach correo in array p_otros loop
    select id into uid from auth.users where lower(email) = lower(trim(correo));
    if uid is null then raise exception 'No existe el usuario %', correo; end if;
    if uid = destino then continue; end if;
    perform mover_negocio(uid, destino);
    insert into miembros (auth_id, negocio_id, email, nombre, rol)
    values (uid, destino, lower(trim(correo)), '', p_rol)
    on conflict (auth_id) do update set negocio_id = excluded.negocio_id, rol = excluded.rol, cadete_id = null;
    n := n + 1;
  end loop;
  return format('Listo: %s cuenta(s) unidas al negocio de %s. Que vuelvan a entrar a la app.', n, p_principal);
end $$;
revoke execute on function unir_cuentas(text, text[], text) from public, anon, authenticated;

/* ---------- qué cargó cada cuenta (para el SQL Editor) ---------- */
create or replace function resumen_cuentas()
returns table (email text, pertenece_a text, rol text, clientes bigint, pagos bigint, entregas bigint, pedidos bigint, productos bigint, menus bigint)
language sql stable security definer set search_path = public, auth as $$
  select u.email::text,
         coalesce((select n.email::text from miembros m join auth.users n on n.id = m.negocio_id where m.auth_id = u.id), '(negocio propio)'),
         coalesce((select m.rol from miembros m where m.auth_id = u.id), 'dueno'),
         (select count(*) from clientes x where x.user_id = u.id),
         (select count(*) from pagos x where x.user_id = u.id),
         (select count(*) from entregas x where x.user_id = u.id),
         (select count(*) from comandas x where x.user_id = u.id),
         (select count(*) from productos x where x.user_id = u.id),
         (select count(*) from menus x where x.user_id = u.id)
  from auth.users u
  order by u.created_at
$$;
revoke execute on function resumen_cuentas() from public, anon, authenticated;

/* ---------- el equipo lo ven y lo manejan los dueños del negocio ---------- */
drop policy if exists "leer" on miembros;
drop policy if exists "dueño modifica" on miembros;
drop policy if exists "dueño borra" on miembros;
create policy "leer" on miembros for select using (auth_id = auth.uid() or (negocio_id = mi_negocio() and mi_rol() = 'dueno'));
create policy "dueño modifica" on miembros for update using (negocio_id = mi_negocio() and mi_rol() = 'dueno') with check (negocio_id = mi_negocio());
create policy "dueño borra" on miembros for delete using (negocio_id = mi_negocio() and mi_rol() = 'dueno' and auth_id <> auth.uid());

/* ---------- la configuración es del negocio, no de cada usuario ---------- */
alter table negocio_config alter column user_id set default mi_negocio();
drop policy if exists "dueño escribe" on negocio_config;
drop policy if exists "dueño modifica" on negocio_config;
create policy "dueño escribe" on negocio_config for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on negocio_config for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());

-- que la API vea los cambios enseguida
notify pgrst, 'reload schema';

commit;


-- ============================================================
-- Migración v7 de la app de Viandas — "no lo recibió"
--   · Nuevo estado para una vianda de pack: el cadete fue y no la
--     recibieron, pero cuenta como vianda: usa el crédito y descuenta el
--     stock, igual que una entregada.
--   · "Saltear" sigue siendo lo de antes: ese día no recibe y no usa crédito.
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede volver a correr sin problema.
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


-- ============================================================
-- Migración v8 de la app de Viandas — créditos solo para los packs
--   · Pack de dietas: prepago. Sin créditos no se le entrega (como antes).
--   · Sanatorio y empresa: van a cuenta. Se les entrega aunque no tengan
--     créditos; lo que deben se cobra a fin de semana (en la app se ve en
--     amarillo) y al cargar el pago vuelve a cero.
--   · Casual: no usa créditos.
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede volver a correr sin problema.
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


-- ============================================================
-- Migración v9 de la app de Viandas — avisos de renovación
--   · Se anota cuándo se le avisó por WhatsApp a un pack que se queda sin
--     créditos, para no avisarle dos veces. Lo pueden anotar el dueño y el
--     ayudante.
--   · Al cargarle créditos, el aviso se borra solo: la próxima vez que se
--     quede sin, arranca como "sin avisar".
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede volver a correr sin problema.
-- ============================================================

begin;

alter table clientes add column if not exists aviso_saldo_at timestamptz;

create or replace function marcar_aviso_saldo(cid uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if mi_rol() is null or mi_rol() not in ('dueno', 'ayudante') then raise exception 'Tu usuario no puede registrar avisos'; end if;
  update clientes set aviso_saldo_at = t where id = cid and user_id = mi_negocio();
  if not found then raise exception 'Cliente inexistente'; end if;
  return t;
end $$;
revoke execute on function marcar_aviso_saldo(uuid) from public, anon;
grant execute on function marcar_aviso_saldo(uuid) to authenticated;

-- al cargar créditos, el aviso anterior ya no corre
create or replace function pagos_despues() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.viandas > 0 then update clientes set aviso_saldo_at = null where id = new.cliente_id; end if;
  return null;
end $$;
drop trigger if exists pagos_despues on pagos;
create trigger pagos_despues after insert on pagos for each row execute function pagos_despues();

create or replace function version_base() returns integer language sql immutable as $$ select 9 $$;
grant execute on function version_base() to authenticated;

-- que la API vea los cambios enseguida
notify pgrst, 'reload schema';

commit;


-- ============================================================
-- Migración v10 de la app de Viandas — sanatorio y empresas que piden distinto
--   · Precio propio por cliente (precio por plato): sus pedidos se calculan con
--     ese precio en vez del de la carta.
--   · Cuenta en plata de los pedidos: cada pedido suma apenas se carga (si se
--     cancela o se borra deja de sumar) y se cobra a fin de semana. Los pagos de pedidos quedan marcados aparte de los
--     créditos de los packs.
--   · "Pidieron": cuántos platos pidió el cliente ese día (el pedido se arma
--     con lo que hay, dentro de eso).
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Se puede volver a correr sin problema.
-- ============================================================

begin;

alter table clientes add column if not exists precio_vianda numeric(12,2);

alter table pagos add column if not exists concepto text not null default 'creditos';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_concepto_chk') then
    alter table pagos add constraint pagos_concepto_chk check (concepto in ('creditos', 'pedidos'));
  end if;
end $$;

-- cuántos platos pidió el cliente cada día
create table if not exists pedidos_pidieron (
  user_id uuid not null default mi_negocio(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  fecha date not null,
  cantidad integer not null check (cantidad > 0),
  updated_at timestamptz not null default now(),
  primary key (cliente_id, fecha)
);
alter table pedidos_pidieron enable row level security;
drop policy if exists "leer" on pedidos_pidieron;
drop policy if exists "escribir" on pedidos_pidieron;
create policy "leer" on pedidos_pidieron for select using (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante'));
create policy "escribir" on pedidos_pidieron for all using (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante'))
  with check (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante'));
grant select, insert, update, delete on pedidos_pidieron to authenticated;

-- cuenta de los pedidos de cada cliente: lo entregado (platos y plata), lo pagado y lo que debe
create or replace function cuentas_pedidos()
returns table (cliente_id uuid, platos bigint, entregado numeric, pagado numeric, saldo numeric, ultimo_pago date, platos_sin_pagar bigint)
language sql stable security definer set search_path = public as $$
  with e as (select k.cliente_id, sum(k.cantidad) as platos, sum(k.cantidad * coalesce(k.precio, 0)) as total
             from comandas k where k.estado <> 'cancelada' group by k.cliente_id),
       p as (select x.cliente_id, sum(coalesce(x.monto, 0)) as total, max(x.fecha) as ultimo
             from pagos x where x.concepto = 'pedidos' group by x.cliente_id),
       b as (select c.id, coalesce(e.platos, 0) as platos, coalesce(e.total, 0) as entregado, coalesce(p.total, 0) as pagado,
                    coalesce(e.total, 0) - coalesce(p.total, 0) as saldo, p.ultimo
             from clientes c left join e on e.cliente_id = c.id left join p on p.cliente_id = c.id
             where c.user_id = mi_negocio() and auth.uid() is not null and mi_rol() in ('dueno', 'ayudante')
               and (e.total is not null or p.total is not null))
  -- un pedido suma a la cuenta apenas se carga (si se cancela o se borra, deja de sumar)
  -- platos sin pagar: los más recientes que todavía no cubre lo pagado
  select b.id, b.platos, b.entregado, b.pagado, b.saldo, b.ultimo,
         coalesce((select sum(x.cantidad) from (
                     select k.cantidad, k.cantidad * coalesce(k.precio, 0) as valor,
                            sum(k.cantidad * coalesce(k.precio, 0)) over (order by k.fecha desc, k.created_at desc) as acum
                     from comandas k where k.cliente_id = b.id and k.estado <> 'cancelada') x
                   where x.acum - x.valor < greatest(b.saldo, 0)), 0)::bigint
  from b
$$;
revoke execute on function cuentas_pedidos() from public, anon;
grant execute on function cuentas_pedidos() to authenticated;

create or replace function version_base() returns integer language sql immutable as $$ select 10 $$;
grant execute on function version_base() to authenticated;

-- que la API vea los cambios enseguida
notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v11 — packs sin créditos: se les sigue entregando
--   Un pack de dietas con 0 créditos (o menos) recibe igual sus viandas: cada
--   entrega le sigue descontando y queda debiendo créditos (saldo negativo),
--   que se cubren al renovar el pack.
-- ============================================================

begin;

create or replace function entregas_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c clientes%rowtype;
  rol text := mi_rol();
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

  -- ya no se frena por créditos: un pack sin créditos recibe igual y cada vianda le sigue
  -- descontando (queda debiendo); sanatorios y empresas van a cuenta y los casuales no usan créditos

  if new.cadete_id is null then new.cadete_id := cadete_del_dia(new.cliente_id, new.fecha); end if;
  new.registrado_por := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 11 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v12 — viandas de más (o de menos) para un día
--   Desde Hoy, el dueño o el ayudante pueden cambiar cuántas viandas lleva
--   alguien ese día; cada una usa un crédito (y su stock). Lo que se cambia
--   se conserva cuando el cadete marca la entrega.
-- ============================================================

begin;

create or replace function entregas_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c clientes%rowtype;
  rol text := mi_rol();
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
    -- el cadete no cambia cuántas viandas lleva: se conserva lo que había (o lo de la ficha)
    if rol = 'cadete' then
      if tg_op = 'UPDATE' then new.cant_almuerzo := old.cant_almuerzo; new.cant_cena := old.cant_cena;
      else new.cant_almuerzo := null; new.cant_cena := null; end if;
    end if;
  end if;
  -- el dueño y el ayudante pueden sumar o quitar viandas solo para ese día (al menos una)
  if new.cant_almuerzo is not null and new.cant_almuerzo < 1 then new.cant_almuerzo := 1; end if;
  if new.cant_cena is not null and new.cant_cena < 1 then new.cant_cena := 1; end if;

  -- cada vianda de la ficha del cliente es una unidad
  if new.almuerzo in ('entregado', 'no_recibido') and new.cant_almuerzo is null then
    new.cant_almuerzo := case when tg_op = 'UPDATE' and old.almuerzo in ('entregado', 'no_recibido') and old.cant_almuerzo is not null
                              then old.cant_almuerzo else greatest(c.cant_almuerzo, 1) end;
  end if;
  if new.cena in ('entregado', 'no_recibido') and new.cant_cena is null then
    new.cant_cena := case when tg_op = 'UPDATE' and old.cena in ('entregado', 'no_recibido') and old.cant_cena is not null
                          then old.cant_cena else greatest(c.cant_cena, 1) end;
  end if;

  -- ya no se frena por créditos: un pack sin créditos recibe igual y cada vianda le sigue
  -- descontando (queda debiendo); sanatorios y empresas van a cuenta y los casuales no usan créditos

  if new.cadete_id is null then new.cadete_id := cadete_del_dia(new.cliente_id, new.fecha); end if;
  new.registrado_por := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 12 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v13 — días sin entregas (feriados, vacaciones, cierres)
--   Un día cerrado no tiene entregas de packs ni fijos: nadie usa créditos
--   y "le alcanza hasta" lo saltea. Los pedidos se pueden cargar igual.
-- ============================================================

begin;

create table if not exists dias_cerrados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  fecha date not null,
  motivo text not null default '',
  created_at timestamptz not null default now(),
  constraint dias_cerrados_uno_por_dia unique (user_id, fecha)
);

alter table dias_cerrados enable row level security;
drop policy if exists "leer" on dias_cerrados;
drop policy if exists "cerrar" on dias_cerrados;
drop policy if exists "abrir" on dias_cerrados;
create policy "leer" on dias_cerrados for select using (user_id = mi_negocio());
-- el dueño cualquier día; el ayudante, de hoy en adelante
create policy "cerrar" on dias_cerrados for insert with check (
  user_id = mi_negocio() and (mi_rol() = 'dueno' or (mi_rol() = 'ayudante' and fecha >= hoy_ar())));
create policy "abrir" on dias_cerrados for delete using (
  user_id = mi_negocio() and (mi_rol() = 'dueno' or (mi_rol() = 'ayudante' and fecha >= hoy_ar())));
grant select, insert, delete on dias_cerrados to authenticated;

create or replace function version_base() returns integer language sql immutable as $$ select 13 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v14 — formas de pago
--   Cada pedido y cada pago guarda cómo se pagó: efectivo, transferencia o
--   Mercado Pago; un pedido también puede ir "a cuenta / paga después".
--   La cuenta de pedidos suma solo lo que va a cuenta (y, como hasta ahora,
--   los pedidos de sanatorios y empresas que no tienen forma de pago).
-- ============================================================

begin;

alter table comandas add column if not exists forma_pago text;
alter table pagos add column if not exists forma_pago text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'comandas_forma_pago_check') then
    alter table comandas add constraint comandas_forma_pago_check
      check (forma_pago is null or forma_pago in ('efectivo', 'transferencia', 'mercadopago', 'cuenta'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pagos_forma_pago_check') then
    alter table pagos add constraint pagos_forma_pago_check
      check (forma_pago is null or forma_pago in ('efectivo', 'transferencia', 'mercadopago'));
  end if;
end $$;

create or replace function cuentas_pedidos()
returns table (cliente_id uuid, platos bigint, entregado numeric, pagado numeric, saldo numeric, ultimo_pago date, platos_sin_pagar bigint)
language sql stable security definer set search_path = public as $$
  -- lo que va a cuenta: lo marcado "a cuenta / paga después", y los pedidos de sanatorios y empresas sin forma de pago
  with ac as (select k.cliente_id, k.cantidad, k.precio, k.fecha, k.created_at
              from comandas k join clientes c on c.id = k.cliente_id
              where k.estado <> 'cancelada' and c.user_id = mi_negocio()
                and (k.forma_pago = 'cuenta' or (k.forma_pago is null and c.tipo in ('sanatorio', 'empresa')))),
       e as (select ac.cliente_id, sum(ac.cantidad) as platos, sum(ac.cantidad * coalesce(ac.precio, 0)) as total
             from ac group by ac.cliente_id),
       p as (select x.cliente_id, sum(coalesce(x.monto, 0)) as total, max(x.fecha) as ultimo
             from pagos x where x.concepto = 'pedidos' group by x.cliente_id),
       b as (select c.id, coalesce(e.platos, 0) as platos, coalesce(e.total, 0) as entregado, coalesce(p.total, 0) as pagado,
                    coalesce(e.total, 0) - coalesce(p.total, 0) as saldo, p.ultimo
             from clientes c left join e on e.cliente_id = c.id left join p on p.cliente_id = c.id
             where c.user_id = mi_negocio() and auth.uid() is not null and mi_rol() in ('dueno', 'ayudante')
               and (e.total is not null or p.total is not null))
  -- platos sin pagar: los más recientes que todavía no cubre lo pagado
  select b.id, b.platos, b.entregado, b.pagado, b.saldo, b.ultimo,
         coalesce((select sum(x.cantidad) from (
                     select ac.cantidad, ac.cantidad * coalesce(ac.precio, 0) as valor,
                            sum(ac.cantidad * coalesce(ac.precio, 0)) over (order by ac.fecha desc, ac.created_at desc) as acum
                     from ac where ac.cliente_id = b.id) x
                   where x.acum - x.valor < greatest(b.saldo, 0)), 0)::bigint
  from b
$$;
revoke execute on function cuentas_pedidos() from public, anon;
grant execute on function cuentas_pedidos() to authenticated;

create or replace function version_base() returns integer language sql immutable as $$ select 14 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v15 — la carta
--   La carta que se arma en la pestaña Menú (secciones y platos) se guarda con
--   la configuración del negocio. Su imagen se publica en un lugar público fijo
--   (Supabase Storage, carpeta "cartas"): el link siempre muestra la última.
-- ============================================================

begin;

alter table negocio_config add column if not exists carta jsonb;

-- el lugar de la imagen (solo si el proyecto tiene Storage, como todo proyecto de Supabase)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('cartas', 'cartas', true)
      on conflict (id) do update set public = true;
    execute 'drop policy if exists "cartas: ver" on storage.objects';
    execute 'drop policy if exists "cartas: subir" on storage.objects';
    execute 'drop policy if exists "cartas: cambiar" on storage.objects';
    execute 'drop policy if exists "cartas: borrar" on storage.objects';
    execute 'create policy "cartas: ver" on storage.objects for select using (bucket_id = ''cartas'')';
    -- cada negocio sube solo a su carpeta (la del id del negocio); el dueño y el ayudante
    execute 'create policy "cartas: subir" on storage.objects for insert to authenticated with check (bucket_id = ''cartas'' and (storage.foldername(name))[1] = mi_negocio()::text and mi_rol() in (''dueno'', ''ayudante''))';
    execute 'create policy "cartas: cambiar" on storage.objects for update to authenticated using (bucket_id = ''cartas'' and (storage.foldername(name))[1] = mi_negocio()::text and mi_rol() in (''dueno'', ''ayudante''))';
    execute 'create policy "cartas: borrar" on storage.objects for delete to authenticated using (bucket_id = ''cartas'' and (storage.foldername(name))[1] = mi_negocio()::text and mi_rol() in (''dueno'', ''ayudante''))';
  end if;
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 15 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v16 — un solo stock
--   Los platos y el stock pasan a ser una sola lista (pestaña Stock): cada
--   plato lleva su propio stock, un producto con su mismo nombre. Esto ordena
--   lo que ya estaba cargado, una sola vez: si un plato tiene un producto con
--   su mismo nombre que no es de otro plato, pasa a descontar de ese (antes
--   podía estar enlazado a otro producto, o a ninguno). Las promos y los
--   combos (más de un producto, o más de 1 por plato) no se tocan. Los pedidos
--   pendientes de esos platos, de hoy en adelante, vuelven a calcular lo que
--   descuentan.
-- ============================================================

begin;

do $$
declare r comandas;
begin
  if exists (select 1 from app_migraciones where nombre = 'v16-un-stock') then return; end if;

  create temp table v16_pares on commit drop as
  with prod as (
    select p.id, p.user_id, p.created_at,
           regexp_replace(lower(translate(trim(p.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') as n
    from productos p where not p.es_guarnicion
  ), men as (
    select m.id, m.user_id, m.activo, m.created_at,
           regexp_replace(lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') as n
    from menus m
  ), it as (
    select menu_id, count(*) as k, min(cantidad) as cant, (array_agg(producto_id))[1] as pid
    from menu_productos group by menu_id
  ), propio as (   -- los platos que ya tienen su stock propio, con ese producto
    select men.id as menu_id, it.pid
    from men join it on it.menu_id = men.id and it.k = 1 and it.cant = 1
      join prod on prod.id = it.pid and prod.n = men.n
  ), cand as (
    select men.id as menu_id, prod.id as producto_id, men.user_id,
           row_number() over (partition by prod.id order by men.activo desc, men.created_at desc) as r1,
           row_number() over (partition by men.id order by prod.created_at) as r2
    from men join prod on prod.user_id = men.user_id and prod.n = men.n
      left join it on it.menu_id = men.id
    where not exists (select 1 from propio where propio.menu_id = men.id)
      and not exists (select 1 from propio where propio.pid = prod.id)
      and (it.menu_id is null or (it.k = 1 and it.cant = 1))
  )
  select menu_id, producto_id, user_id from cand where r1 = 1 and r2 = 1;

  delete from menu_productos where menu_id in (select menu_id from v16_pares);
  insert into menu_productos (menu_id, producto_id, user_id, cantidad)
    select menu_id, producto_id, user_id, 1 from v16_pares;
  -- si el plato está activo, su stock también
  update productos p set activo = true
    from v16_pares x join menus m on m.id = x.menu_id
    where p.id = x.producto_id and m.activo and not p.activo;

  -- los pedidos pendientes de esos platos descuentan de su producto
  for r in select c.* from comandas c
             where c.estado = 'pendiente' and c.fecha >= hoy_ar() and c.menu_id in (select menu_id from v16_pares) loop
    delete from movimientos where comanda_id = r.id;
    perform descontar_comanda(r);
  end loop;

  insert into app_migraciones (nombre) values ('v16-un-stock');
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 16 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v17 — categorías de los platos
--   La lista de categorías (Carnes, Pollo, Bebidas…), en su orden, se guarda
--   con la configuración del negocio. Se edita desde la app: agregar, cambiar
--   el nombre, ordenar y borrar. Cada plato tiene una, y cada sección de la
--   carta muestra solo los platos de su categoría.
-- ============================================================

begin;

alter table negocio_config add column if not exists categorias jsonb;

create or replace function version_base() returns integer language sql immutable as $$ select 17 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v18 — el menú del día es una categoría, no un plato
--   "Menú del día" y "Menú sin TACC" dejan de ser platos con stock propio:
--   se desactivan (y su stock, si no lo usa otro plato), y salen de la carta
--   y del menú de cada día. La categoría "Del día" pasa a llamarse "Menú del
--   día". Un pedido del menú del día lleva el plato que se le asignó a ese
--   día, y descuenta el stock de ese plato y de su guarnición.
--   Se hace una sola vez.
-- ============================================================

begin;

-- el precio del menú del día y el del menú sin TACC: ya no son el precio de un plato
alter table negocio_config add column if not exists precio_menu_dia numeric(12,2);
alter table negocio_config add column if not exists precio_menu_sin_tacc numeric(12,2);
update negocio_config nc set precio_menu_dia = (select m.precio from menus m where m.user_id = nc.user_id and m.precio is not null
    and regexp_replace(lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') = 'menu del dia'
    order by m.activo desc, m.created_at limit 1)
  where nc.precio_menu_dia is null;
update negocio_config nc set precio_menu_sin_tacc = (select m.precio from menus m where m.user_id = nc.user_id and m.precio is not null
    and regexp_replace(lower(translate(trim(m.nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') in ('menu sin tacc', 'menu del dia sin tacc')
    order by m.activo desc, m.created_at limit 1)
  where nc.precio_menu_sin_tacc is null;

do $$
begin
  if exists (select 1 from app_migraciones where nombre = 'v18-menu-del-dia') then return; end if;

  create temp table v18_menus on commit drop as
    select id from menus
    where regexp_replace(lower(translate(trim(nombre), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') in ('menu del dia', 'menu sin tacc', 'menu del dia sin tacc');

  -- su stock deja de contarse, salvo que lo use otro plato activo
  update productos p set activo = false
  where p.id in (select mp.producto_id from menu_productos mp where mp.menu_id in (select id from v18_menus))
    and not exists (select 1 from menu_productos o join menus m on m.id = o.menu_id
                    where o.producto_id = p.id and m.activo and o.menu_id not in (select id from v18_menus));
  update menus set activo = false where id in (select id from v18_menus);
  delete from carta_dia where menu_id in (select id from v18_menus);

  -- la categoría "Del día" pasa a ser "Menú del día"
  update menus set categoria = 'Menú del día'
  where regexp_replace(lower(translate(trim(categoria), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') = 'del dia';
  update negocio_config nc set categorias = (
    select coalesce(jsonb_agg(to_jsonb(b.c) order by b.primero), '[]'::jsonb) from (
      select a.c, min(a.ord) as primero from (
        select case when regexp_replace(lower(translate(trim(e.x), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') in ('del dia', 'menu del dia')
                    then 'Menú del día' else e.x end as c, e.ord
        from jsonb_array_elements_text(nc.categorias) with ordinality e(x, ord)) a
      group by a.c) b)
  where jsonb_typeof(nc.categorias) = 'array';

  -- la carta: sin esos platos, y la sección del día con la categoría nueva
  update negocio_config nc set carta = jsonb_set(nc.carta, '{secciones}', coalesce((
      select jsonb_agg(jsonb_set(
          case when regexp_replace(lower(translate(trim(coalesce(t.s->>'categoria', '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g') = 'del dia'
               then jsonb_set(t.s, '{categoria}', to_jsonb('Menú del día'::text)) else t.s end,
          '{items}', coalesce((select jsonb_agg(i.it order by i.k) from jsonb_array_elements(t.s->'items') with ordinality i(it, k)
                               where i.it->>'menuId' is null or i.it->>'menuId' not in (select id::text from v18_menus)), '[]'::jsonb))
        order by t.ord)
      from jsonb_array_elements(nc.carta->'secciones') with ordinality t(s, ord)), '[]'::jsonb))
  where nc.carta is not null and jsonb_typeof(nc.carta->'secciones') = 'array';

  insert into app_migraciones (nombre) values ('v18-menu-del-dia');
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 18 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v19 — avisos por WhatsApp a los packs
--   En el perfil de cada pack se elige cuándo se le avisa que se queda sin
--   créditos: nunca, todos los días o un día de la semana (1 = lunes …
--   7 = domingo). Ese día aparece en Hoy, en "Avisos por WhatsApp", para
--   mandarle el mensaje con un toque (queda anotado, como hasta ahora).
-- ============================================================

begin;

alter table clientes add column if not exists aviso_wa text not null default 'nunca';
alter table clientes add column if not exists aviso_wa_dia smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_aviso_wa_check') then
    alter table clientes add constraint clientes_aviso_wa_check
      check (aviso_wa in ('nunca', 'diario', 'semanal') and (aviso_wa_dia is null or aviso_wa_dia between 1 and 7));
  end if;
end $$;

create or replace function version_base() returns integer language sql immutable as $$ select 19 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v20 — los cadetes, por link
--   El dueño o el ayudante arma un link para cada cadete (para hoy o para la
--   semana) y se lo manda por WhatsApp. El cadete lo abre sin usuario ni
--   contraseña: ve sus entregas del día de a una, en el orden del recorrido, y
--   las marca desde ahí. Mientras tiene el link abierto, su ubicación queda
--   registrada para ver dónde está y por dónde fue.
--   Un link sirve solo para ese cadete y esas fechas, y se puede anular. Con el
--   link, la base lo trata igual que a un cadete con usuario: las mismas reglas.
-- ============================================================

begin;

create table if not exists cadete_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  cadete_id uuid not null references cadetes(id) on delete cascade,
  token text not null unique,
  desde date not null,
  hasta date not null,
  revocado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cadete_links_cadete_idx on cadete_links (user_id, cadete_id);
alter table cadete_links enable row level security;
drop policy if exists "leer" on cadete_links;
drop policy if exists "crear" on cadete_links;
drop policy if exists "anular" on cadete_links;
create policy "leer" on cadete_links for select using (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante'));
create policy "crear" on cadete_links for insert with check (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante'));
create policy "anular" on cadete_links for update using (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante')) with check (user_id = mi_negocio());
grant select, insert, update on cadete_links to authenticated;

create table if not exists cadete_posiciones (
  id bigserial primary key,
  user_id uuid not null,
  cadete_id uuid not null references cadetes(id) on delete cascade,
  fecha date not null,
  lat double precision not null,
  lng double precision not null,
  precision real,
  at timestamptz not null default now()
);
create index if not exists cadete_posiciones_idx on cadete_posiciones (user_id, fecha, cadete_id, at);
alter table cadete_posiciones enable row level security;
drop policy if exists "leer" on cadete_posiciones;
create policy "leer" on cadete_posiciones for select using (user_id = mi_negocio() and mi_rol() in ('dueno', 'ayudante'));
grant select on cadete_posiciones to authenticated;

-- la sesión de un link: dentro de las funciones de abajo (después de validar el link) cuenta como la
-- del cadete. Fuera de ellas no hay forma de fijar estos valores, así que todo sigue igual.
create or replace function mi_negocio() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select negocio_id from miembros where auth_id = auth.uid()), auth.uid(),
                  nullif(current_setting('app.link_negocio', true), '')::uuid)
$$;
create or replace function mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is not null then coalesce((select rol from miembros where auth_id = auth.uid()), 'dueno')
              when nullif(current_setting('app.link_cadete', true), '') is not null then 'cadete' end
$$;
create or replace function mi_cadete() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select cadete_id from miembros where auth_id = auth.uid()), nullif(current_setting('app.link_cadete', true), '')::uuid)
$$;

-- el cadete puede marcar entregados (o volver a pendiente) los pedidos de hoy de su ruta; nada más
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
  if rol = 'cadete' then
    if tg_op <> 'UPDATE' or new.fecha <> hoy_ar() or old.estado = 'cancelada' or new.estado not in ('pendiente', 'entregada')
       or (new.cliente_id, new.fecha, new.turno, new.menu_id, new.guarnicion_id, new.cantidad, new.precio, new.nota, new.forma_pago)
          is distinct from (old.cliente_id, old.fecha, old.turno, old.menu_id, old.guarnicion_id, old.cantidad, old.precio, old.nota, old.forma_pago)
       or cadete_del_dia(new.cliente_id, new.fecha) is distinct from mi_cadete() then
      raise exception 'Tu usuario no puede modificar comandas';
    end if;
    if new.estado = 'entregada' and old.estado <> 'entregada' then new.entregada_at := now(); new.entregada_por := auth.uid();
    elsif new.estado <> 'entregada' then new.entregada_at := null; new.entregada_por := null; end if;
    return new;
  end if;
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

/* ---------- lo que usa la página del cadete (sin usuario: con el link) ---------- */
-- un link vigente: hoy entre sus fechas y sin anular
create or replace function link_vigente(p_token text) returns cadete_links
language plpgsql stable security definer set search_path = public as $$
declare l cadete_links;
begin
  select * into l from cadete_links where token = p_token;
  if not found or l.revocado or hoy_ar() not between l.desde and l.hasta then raise exception 'link_vencido'; end if;
  return l;
end $$;
revoke execute on function link_vigente(text) from public, anon, authenticated;

-- todo lo que necesita para armar su recorrido de hoy: sus clientes, sus entregas y pedidos, el orden
create or replace function ruta_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l cadete_links := link_vigente(p_token);
  hoy date := hoy_ar();
  ids uuid[];
begin
  select coalesce(array_agg(c.id), '{}') into ids from clientes c where c.user_id = l.user_id and cadete_del_dia(c.id, hoy) = l.cadete_id;
  return jsonb_build_object(
    'fecha', hoy, 'hasta', l.hasta,
    'negocio', (select jsonb_build_object('nombre', n.nombre, 'cocina_direccion', n.cocina_direccion, 'cocina_lat', n.cocina_lat, 'cocina_lng', n.cocina_lng)
                from negocio_config n where n.user_id = l.user_id),
    'cadete', (select jsonb_build_object('id', k.id, 'nombre', k.nombre, 'telefono', k.telefono, 'color', k.color) from cadetes k where k.id = l.cadete_id),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'telefono', c.telefono, 'notas', c.notas,
        'activo', c.activo, 'direccion', c.direccion, 'referencia', c.referencia, 'lat', c.lat, 'lng', c.lng, 'dias', c.dias,
        'cant_almuerzo', c.cant_almuerzo, 'cant_cena', c.cant_cena, 'cadete_id', c.cadete_id, 'menu_almuerzo_id', c.menu_almuerzo_id,
        'created_at', c.created_at)) from clientes c where c.id = any(ids)), '[]'::jsonb),
    'entregas', coalesce((select jsonb_agg(to_jsonb(e)) from entregas e where e.cliente_id = any(ids) and e.fecha = hoy), '[]'::jsonb),
    'comandas', coalesce((select jsonb_agg(to_jsonb(x)) from comandas x where x.cliente_id = any(ids) and x.fecha = hoy), '[]'::jsonb),
    'rutas', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', r.cliente_id, 'fecha', r.fecha, 'cadete_id', r.cadete_id, 'orden', r.orden))
                       from rutas r where r.cliente_id = any(ids) and r.fecha = hoy), '[]'::jsonb),
    'menus', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'lleva_guarnicion', m.lleva_guarnicion, 'activo', m.activo,
        'precio', m.precio, 'categoria', m.categoria)) from menus m where m.user_id = l.user_id), '[]'::jsonb),
    'guarniciones', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre)) from productos p where p.user_id = l.user_id and p.es_guarnicion), '[]'::jsonb),
    'cerrado', exists (select 1 from dias_cerrados d where d.user_id = l.user_id and d.fecha = hoy)
  );
end $$;
grant execute on function ruta_link(text) to anon, authenticated;

-- marcar una parada: las viandas de sus turnos y su pedido. p_estado: entregado | no_recibido | pendiente (deshacer)
create or replace function marcar_link(p_token text, p_cliente uuid, p_turnos text[], p_estado text, p_pedido boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l cadete_links := link_vigente(p_token);
  hoy date := hoy_ar();
  t text;
  v text := case p_estado when 'pendiente' then null else p_estado end;
begin
  if p_estado not in ('entregado', 'no_recibido', 'pendiente') then raise exception 'Estado inválido'; end if;
  -- desde acá, la base lo trata como al cadete: las mismas reglas que con su usuario
  perform set_config('app.link_negocio', l.user_id::text, true);
  perform set_config('app.link_cadete', l.cadete_id::text, true);
  if cadete_del_dia(p_cliente, hoy) is distinct from l.cadete_id then raise exception 'Este cliente no está en tu ruta de hoy'; end if;
  foreach t in array coalesce(p_turnos, '{}') loop
    if t = 'almuerzo' then
      insert into entregas (user_id, cliente_id, fecha, almuerzo) values (l.user_id, p_cliente, hoy, v)
        on conflict (cliente_id, fecha) do update set almuerzo = excluded.almuerzo;
    elsif t = 'cena' then
      insert into entregas (user_id, cliente_id, fecha, cena) values (l.user_id, p_cliente, hoy, v)
        on conflict (cliente_id, fecha) do update set cena = excluded.cena;
    end if;
  end loop;
  if p_pedido and p_estado = 'entregado' then
    update comandas set estado = 'entregada' where cliente_id = p_cliente and fecha = hoy and estado = 'pendiente';
  elsif p_pedido and p_estado = 'pendiente' then
    update comandas set estado = 'pendiente' where cliente_id = p_cliente and fecha = hoy and estado = 'entregada';
  end if;
  return ruta_link(p_token);
end $$;
grant execute on function marcar_link(text, uuid, text[], text, boolean) to anon, authenticated;

-- dónde está el cadete (una vez cada 10 segundos como mucho)
create or replace function posicion_link(p_token text, p_lat double precision, p_lng double precision, p_precision double precision default null) returns void
language plpgsql security definer set search_path = public as $$
declare l cadete_links := link_vigente(p_token);
begin
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return; end if;
  if exists (select 1 from cadete_posiciones x where x.cadete_id = l.cadete_id and x.at > now() - interval '10 seconds') then return; end if;
  insert into cadete_posiciones (user_id, cadete_id, fecha, lat, lng, precision) values (l.user_id, l.cadete_id, hoy_ar(), p_lat, p_lng, p_precision);
end $$;
grant execute on function posicion_link(text, double precision, double precision, double precision) to anon, authenticated;

create or replace function version_base() returns integer language sql immutable as $$ select 20 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- v21 — cómo reparte cada cadete: en vehículo o caminando
--   Cambia el recorrido por las calles (caminando no hay calles de una mano),
--   el tiempo, el orden optimizado y cómo lo guía Google Maps.
-- ============================================================

begin;

alter table cadetes add column if not exists medio text not null default 'vehiculo';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cadetes_medio_check') then
    alter table cadetes add constraint cadetes_medio_check check (medio in ('vehiculo', 'pie'));
  end if;
end $$;

-- la página del cadete también lo necesita
create or replace function ruta_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l cadete_links := link_vigente(p_token);
  hoy date := hoy_ar();
  ids uuid[];
begin
  select coalesce(array_agg(c.id), '{}') into ids from clientes c where c.user_id = l.user_id and cadete_del_dia(c.id, hoy) = l.cadete_id;
  return jsonb_build_object(
    'fecha', hoy, 'hasta', l.hasta,
    'negocio', (select jsonb_build_object('nombre', n.nombre, 'cocina_direccion', n.cocina_direccion, 'cocina_lat', n.cocina_lat, 'cocina_lng', n.cocina_lng)
                from negocio_config n where n.user_id = l.user_id),
    'cadete', (select jsonb_build_object('id', k.id, 'nombre', k.nombre, 'telefono', k.telefono, 'color', k.color, 'medio', k.medio) from cadetes k where k.id = l.cadete_id),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'telefono', c.telefono, 'notas', c.notas,
        'activo', c.activo, 'direccion', c.direccion, 'referencia', c.referencia, 'lat', c.lat, 'lng', c.lng, 'dias', c.dias,
        'cant_almuerzo', c.cant_almuerzo, 'cant_cena', c.cant_cena, 'cadete_id', c.cadete_id, 'menu_almuerzo_id', c.menu_almuerzo_id,
        'created_at', c.created_at)) from clientes c where c.id = any(ids)), '[]'::jsonb),
    'entregas', coalesce((select jsonb_agg(to_jsonb(e)) from entregas e where e.cliente_id = any(ids) and e.fecha = hoy), '[]'::jsonb),
    'comandas', coalesce((select jsonb_agg(to_jsonb(x)) from comandas x where x.cliente_id = any(ids) and x.fecha = hoy), '[]'::jsonb),
    'rutas', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', r.cliente_id, 'fecha', r.fecha, 'cadete_id', r.cadete_id, 'orden', r.orden))
                       from rutas r where r.cliente_id = any(ids) and r.fecha = hoy), '[]'::jsonb),
    'menus', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'lleva_guarnicion', m.lleva_guarnicion, 'activo', m.activo,
        'precio', m.precio, 'categoria', m.categoria)) from menus m where m.user_id = l.user_id), '[]'::jsonb),
    'guarniciones', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre)) from productos p where p.user_id = l.user_id and p.es_guarnicion), '[]'::jsonb),
    'cerrado', exists (select 1 from dias_cerrados d where d.user_id = l.user_id and d.fecha = hoy)
  );
end $$;
grant execute on function ruta_link(text) to anon, authenticated;

create or replace function version_base() returns integer language sql immutable as $$ select 21 $$;
grant execute on function version_base() to authenticated;

notify pgrst, 'reload schema';

commit;
