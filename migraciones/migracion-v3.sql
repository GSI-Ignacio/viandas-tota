-- ============================================================
-- Migración v3 de la app de Viandas — Fase 1: comandas y menús
--   · Menús armados con productos del stock (ej: Milanesa con puré =
--     1 milanesa + 1 porción de puré)
--   · Comandas: qué menús recibe cada cliente en cada turno. Los clientes
--     con días fijos tienen su comanda automática (menú habitual); los
--     casuales se cargan a mano.
--   · Al marcar una comanda entregada se descuentan del stock los
--     productos de sus menús y los créditos del cliente (1 por vianda).
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Requiere haber corrido migracion-v2.sql. Conserva los datos y se
-- puede volver a correr.
-- ============================================================

begin;

/* ---------- menús ---------- */
create table if not exists menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  nombre text not null,
  descripcion text not null default '',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists menu_productos (
  menu_id uuid not null references menus(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  user_id uuid not null default mi_negocio(),
  cantidad numeric(12,3) not null check (cantidad > 0),
  primary key (menu_id, producto_id)
);

-- menú habitual de cada cliente, para su comanda automática
alter table clientes add column if not exists menu_almuerzo_id uuid references menus(id) on delete set null;
alter table clientes add column if not exists menu_cena_id uuid references menus(id) on delete set null;

/* ---------- comandas: una fila por menú pedido ---------- */
-- La comanda de un cliente para un día y turno es el conjunto de sus filas.
-- Si se entregó o no sigue en la tabla entregas (almuerzo / cena).
create table if not exists comandas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  fecha date not null,
  turno text not null check (turno in ('almuerzo','cena')),
  menu_id uuid references menus(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  nota text not null default '',
  origen text not null default 'manual' check (origen in ('manual','automatica','whatsapp')),
  registrado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists comandas_linea_uq
  on comandas (cliente_id, fecha, turno, coalesce(menu_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists comandas_fecha_idx on comandas (user_id, fecha);

-- Marca los días en que ya se armó la comanda automática de un cliente,
-- así si la borrás a mano no vuelve a aparecer.
create table if not exists comandas_auto (
  cliente_id uuid not null references clientes(id) on delete cascade,
  fecha date not null,
  turno text not null,
  user_id uuid not null,
  primary key (cliente_id, fecha, turno)
);

/* ---------- validación de comandas ---------- */
create or replace function comandas_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rol text := mi_rol();
  c clientes%rowtype;
  r comandas;
  est text;
begin
  -- los borrados en cascada (al eliminar un cliente) no se validan
  if pg_trigger_depth() > 1 then return case when tg_op = 'DELETE' then old else new end; end if;
  if rol is null then raise exception 'Tenés que iniciar sesión'; end if;
  if rol = 'cadete' then raise exception 'Tu usuario no puede modificar comandas'; end if;
  foreach r in array (case when tg_op = 'INSERT' then array[new] when tg_op = 'DELETE' then array[old] else array[old, new] end) loop
    select * into c from clientes where id = r.cliente_id;
    if not found or c.user_id <> mi_negocio() then raise exception 'Cliente inexistente'; end if;
    if rol = 'ayudante' and r.fecha < hoy_ar() then raise exception 'Solo se pueden cargar comandas de hoy en adelante'; end if;
    select case when r.turno = 'almuerzo' then e.almuerzo else e.cena end into est
      from entregas e where e.cliente_id = r.cliente_id and e.fecha = r.fecha;
    if est = 'entregado' then raise exception 'Esa comanda ya se entregó: desmarcá la entrega antes de cambiarla'; end if;
  end loop;
  if tg_op <> 'DELETE' then
    new.user_id := c.user_id;
    if new.menu_id is not null and not exists (select 1 from menus m where m.id = new.menu_id and m.user_id = c.user_id) then
      raise exception 'Menú inexistente';
    end if;
    if tg_op = 'INSERT' then new.registrado_por := auth.uid(); end if;
    return new;
  end if;
  return old;
end $$;

drop trigger if exists comandas_validar on comandas;
create trigger comandas_validar before insert or update or delete on comandas
  for each row execute function comandas_validar();

/* ---------- comandas automáticas ---------- */
-- Arma la comanda del día para los clientes con días fijos que todavía no la tienen.
create or replace function generar_comandas(p_fecha date) returns integer
language plpgsql security definer set search_path = public as $$
declare
  neg uuid := mi_negocio();
  n integer := 0;
begin
  if auth.uid() is null or mi_rol() not in ('dueno', 'ayudante') then return 0; end if;
  if p_fecha < hoy_ar() then return 0; end if;
  with candidatos as (
    select c.id as cliente_id, t.turno, t.menu_id, t.cant
    from clientes c
    cross join lateral (values ('almuerzo', c.menu_almuerzo_id, c.cant_almuerzo), ('cena', c.menu_cena_id, c.cant_cena)) as t(turno, menu_id, cant)
    where c.user_id = neg and c.activo and extract(isodow from p_fecha)::smallint = any(c.dias) and t.cant > 0
      and not exists (select 1 from comandas_auto a where a.cliente_id = c.id and a.fecha = p_fecha and a.turno = t.turno)
      -- si ese turno ya se registró (entregado o no) no se arma: la entrega es la que manda
      and not exists (select 1 from entregas e where e.cliente_id = c.id and e.fecha = p_fecha
                        and (case when t.turno = 'almuerzo' then e.almuerzo else e.cena end) is not null)
  ), marcadas as (
    insert into comandas_auto (cliente_id, fecha, turno, user_id)
    select cliente_id, p_fecha, turno, neg from candidatos
    on conflict do nothing
    returning cliente_id, turno
  ), nuevas as (
    insert into comandas (user_id, cliente_id, fecha, turno, menu_id, cantidad, origen, registrado_por)
    select neg, k.cliente_id, p_fecha, k.turno, k.menu_id, k.cant, 'automatica', auth.uid()
    from candidatos k join marcadas m on m.cliente_id = k.cliente_id and m.turno = k.turno
    where not exists (select 1 from comandas x where x.cliente_id = k.cliente_id and x.fecha = p_fecha and x.turno = k.turno)
    returning 1
  )
  select count(*) into n from nuevas;
  return n;
end $$;

/* ---------- entregas: la cantidad sale de la comanda ---------- */
-- Viandas de la comanda de un cliente para un día y turno (null si no tiene comanda)
create or replace function viandas_comanda(cid uuid, f date, t text) returns integer
language sql stable security definer set search_path = public as $$
  select sum(cantidad)::integer from comandas where cliente_id = cid and fecha = f and turno = t
$$;
revoke execute on function viandas_comanda(uuid, date, text) from public, anon, authenticated;

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

  -- viandas entregadas: las de la comanda; si no tiene, las de su ficha
  if new.almuerzo = 'entregado' and new.cant_almuerzo is null then
    new.cant_almuerzo := case when tg_op = 'UPDATE' and old.almuerzo = 'entregado' and old.cant_almuerzo is not null then old.cant_almuerzo
                              else coalesce(viandas_comanda(new.cliente_id, new.fecha, 'almuerzo'), greatest(c.cant_almuerzo, 1)) end;
  end if;
  if new.cena = 'entregado' and new.cant_cena is null then
    new.cant_cena := case when tg_op = 'UPDATE' and old.cena = 'entregado' and old.cant_cena is not null then old.cant_cena
                          else coalesce(viandas_comanda(new.cliente_id, new.fecha, 'cena'), greatest(c.cant_cena, 1)) end;
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

/* ---------- al entregar: registro + descuento de stock por menú ---------- */
create or replace function entregas_despues() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n entregas;
  o entregas;
  v_nombre text;
  cant integer;
  c clientes%rowtype;
  t text;
begin
  if tg_op = 'DELETE' then n := null; o := old; else n := new; end if;
  if tg_op = 'UPDATE' then o := old; end if;
  select * into c from clientes where id = coalesce(n.cliente_id, o.cliente_id);
  v_nombre := c.nombre;

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

  if tg_op <> 'DELETE' then
    -- un cliente fijo sin comanda ese día: se le arma la automática al entregar
    foreach t in array array['almuerzo', 'cena'] loop
      if (case when t = 'almuerzo' then n.almuerzo else n.cena end) = 'entregado'
         and not exists (select 1 from comandas x where x.cliente_id = n.cliente_id and x.fecha = n.fecha and x.turno = t) then
        insert into comandas_auto (cliente_id, fecha, turno, user_id) values (n.cliente_id, n.fecha, t, n.user_id) on conflict do nothing;
        insert into comandas (user_id, cliente_id, fecha, turno, menu_id, cantidad, origen, registrado_por)
        values (n.user_id, n.cliente_id, n.fecha, t, case when t = 'almuerzo' then c.menu_almuerzo_id else c.menu_cena_id end,
                case when t = 'almuerzo' then coalesce(n.cant_almuerzo, 1) else coalesce(n.cant_cena, 1) end, 'automatica', auth.uid());
      end if;
    end loop;

    delete from movimientos where entrega_id = n.id;
    -- productos de los menús de cada turno entregado
    insert into movimientos (user_id, producto_id, fecha, tipo, cantidad, nota, entrega_id, registrado_por)
    select n.user_id, mp.producto_id, n.fecha, 'entrega', -sum(l.cantidad * mp.cantidad), coalesce(v_nombre, ''), n.id, auth.uid()
    from comandas l
    join menu_productos mp on mp.menu_id = l.menu_id
    join productos p on p.id = mp.producto_id and p.activo
    where l.cliente_id = n.cliente_id and l.fecha = n.fecha
      and ((l.turno = 'almuerzo' and n.almuerzo = 'entregado') or (l.turno = 'cena' and n.cena = 'entregado'))
    group by mp.producto_id;
    -- productos que se usan en toda vianda (envases, cubiertos…)
    if consumo_entrega(n) > 0 then
      insert into movimientos (user_id, producto_id, fecha, tipo, cantidad, nota, entrega_id, registrado_por)
      select n.user_id, p.id, n.fecha, 'entrega', -(p.por_vianda * consumo_entrega(n)), coalesce(v_nombre, ''), n.id, auth.uid()
      from productos p
      where p.user_id = n.user_id and p.activo and p.por_vianda > 0;
    end if;
  end if;
  return null;
end $$;

/* ---------- permisos ---------- */
alter table menus enable row level security;
alter table menu_productos enable row level security;
alter table comandas enable row level security;
alter table comandas_auto enable row level security;

do $$
declare t text;
begin
  foreach t in array array['menus','menu_productos','comandas','comandas_auto'] loop
    execute format('drop policy if exists "leer" on %I', t);
    execute format('drop policy if exists "dueño escribe" on %I', t);
    execute format('drop policy if exists "dueño modifica" on %I', t);
    execute format('drop policy if exists "dueño borra" on %I', t);
  end loop;
end $$;

-- Menús: todo el equipo los lee (el cadete ve qué menú entrega); los arma el dueño
create policy "leer" on menus for select using (user_id = mi_negocio());
create policy "dueño escribe" on menus for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on menus for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on menus for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

create policy "leer" on menu_productos for select using (user_id = mi_negocio());
create policy "dueño escribe" on menu_productos for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on menu_productos for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on menu_productos for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

-- Comandas: las cargan el dueño y el ayudante; el cadete ve las de su ruta
create policy "leer" on comandas for select using (
  user_id = mi_negocio() and (mi_rol() <> 'cadete' or cadete_del_dia(cliente_id, fecha) = mi_cadete()));
create policy "dueño escribe" on comandas for insert with check (user_id = mi_negocio() and mi_rol() in ('dueno','ayudante'));
create policy "dueño modifica" on comandas for update using (user_id = mi_negocio() and mi_rol() in ('dueno','ayudante')) with check (user_id = mi_negocio());
create policy "dueño borra" on comandas for delete using (user_id = mi_negocio() and mi_rol() in ('dueno','ayudante'));

create policy "leer" on comandas_auto for select using (user_id = mi_negocio());

revoke execute on function generar_comandas(date) from public, anon;
grant execute on function generar_comandas(date) to authenticated;

insert into app_migraciones (nombre) values ('v3') on conflict do nothing;

commit;
