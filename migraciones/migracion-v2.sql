-- ============================================================
-- Migración v2 de la app de Viandas
--   · Equipo: ayudantes y cadetes con permisos limitados
--   · Saldo de viandas prepagas para todos los clientes (tabla pagos)
--   · Direcciones, días de entrega, cantidades y rutas por cadete
--   · Productos de stock con movimientos
--   · Registro (log) automático de cada cambio en las entregas
--
-- Cómo usarlo: Supabase → tu proyecto → SQL Editor → pegar todo
-- este archivo → Run. Requiere haber corrido antes schema.sql.
-- Conserva todos los datos existentes y se puede volver a correr.
-- ============================================================

begin;

create table if not exists app_migraciones (
  nombre text primary key,
  aplicada timestamptz not null default now()
);

/* ---------- equipo ---------- */
create table if not exists cadetes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  nombre text not null,
  telefono text not null default '',
  color text not null default '#E2792B',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Usuarios con acceso limitado. El dueño del negocio no figura acá:
-- cualquier usuario que no sea miembro es dueño de su propio negocio.
create table if not exists miembros (
  auth_id uuid primary key,
  negocio_id uuid not null,
  email text not null,
  nombre text not null default '',
  rol text not null check (rol in ('ayudante','cadete')),
  cadete_id uuid references cadetes(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function mi_negocio() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select negocio_id from miembros where auth_id = auth.uid()), auth.uid())
$$;

create or replace function mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null
              else coalesce((select rol from miembros where auth_id = auth.uid()), 'dueno') end
$$;

create or replace function mi_cadete() returns uuid
language sql stable security definer set search_path = public as $$
  select cadete_id from miembros where auth_id = auth.uid()
$$;

create or replace function hoy_ar() returns date
language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

/* ---------- clientes: dirección, días y cantidades ---------- */
alter table clientes add column if not exists direccion text not null default '';
alter table clientes add column if not exists referencia text not null default '';
alter table clientes add column if not exists lat double precision;
alter table clientes add column if not exists lng double precision;
-- días de entrega: 1 = lunes … 7 = domingo
alter table clientes add column if not exists dias smallint[] not null default '{1,2,3,4,5}';
alter table clientes add column if not exists cant_almuerzo integer not null default 1;
alter table clientes add column if not exists cant_cena integer not null default 0;
alter table clientes add column if not exists cadete_id uuid references cadetes(id) on delete set null;

/* ---------- entregas: cantidades, cadete y quién registró ---------- */
alter table entregas add column if not exists cant_almuerzo integer;
alter table entregas add column if not exists cant_cena integer;
alter table entregas add column if not exists cadete_id uuid references cadetes(id) on delete set null;
alter table entregas add column if not exists registrado_por uuid;
alter table entregas add column if not exists updated_at timestamptz not null default now();
create index if not exists entregas_fecha_idx on entregas (user_id, fecha);

/* ---------- pagos: saldo de viandas prepagas ---------- */
create table if not exists pagos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  fecha date not null default hoy_ar(),
  viandas integer not null,
  monto numeric(12,2),
  nota text not null default '',
  registrado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pagos_cliente_idx on pagos (cliente_id);

/* ---------- productos y movimientos de stock ---------- */
create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  nombre text not null,
  unidad text not null default 'unidades',
  minimo numeric(12,2) not null default 0,
  -- cuánto se descuenta solo por cada vianda entregada (0 = no se descuenta)
  por_vianda numeric(12,3) not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists movimientos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  producto_id uuid not null references productos(id) on delete cascade,
  fecha date not null default hoy_ar(),
  tipo text not null check (tipo in ('entrada','salida','ajuste','entrega')),
  cantidad numeric(12,3) not null,
  nota text not null default '',
  entrega_id uuid references entregas(id) on delete cascade,
  registrado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists movimientos_producto_idx on movimientos (producto_id, fecha);
create index if not exists movimientos_entrega_idx on movimientos (entrega_id);

create or replace view productos_stock with (security_invoker = true) as
  select p.*, coalesce((select sum(m.cantidad) from movimientos m where m.producto_id = p.id), 0) as stock
  from productos p;

/* ---------- rutas: cadete y orden de cada cliente por día ---------- */
create table if not exists rutas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default mi_negocio(),
  fecha date not null,
  cliente_id uuid not null references clientes(id) on delete cascade,
  cadete_id uuid references cadetes(id) on delete set null,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  unique (cliente_id, fecha)
);
create index if not exists rutas_fecha_idx on rutas (user_id, fecha);

/* ---------- configuración del negocio ---------- */
alter table negocio_config add column if not exists cocina_direccion text not null default '';
alter table negocio_config add column if not exists cocina_lat double precision;
alter table negocio_config add column if not exists cocina_lng double precision;
alter table negocio_config add column if not exists alerta_viandas integer not null default 3;

/* ---------- registro de entregas (solo lo escribe el trigger) ---------- */
create table if not exists entregas_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  entrega_id uuid,
  cliente_id uuid,
  cliente_nombre text not null default '',
  fecha date not null,
  turno text not null,
  antes text,
  despues text,
  cantidad integer,
  actor_id uuid,
  actor_email text,
  actor_rol text,
  created_at timestamptz not null default now()
);
create index if not exists entregas_log_idx on entregas_log (user_id, fecha desc, created_at desc);

/* ---------- los datos nuevos pertenecen al negocio, no a quien los carga ---------- */
alter table clientes alter column user_id set default mi_negocio();
alter table entregas alter column user_id set default mi_negocio();
alter table stock alter column user_id set default mi_negocio();
alter table cadetes alter column user_id set default mi_negocio();

-- stock diario: único por negocio y fecha (ya lo era por user_id)

/* ---------- saldo de viandas ---------- */
create or replace function consumo_entrega(e entregas) returns integer
language sql immutable as $$
  select (case when e.almuerzo = 'entregado' then coalesce(e.cant_almuerzo, 1) else 0 end)
       + (case when e.cena = 'entregado' then coalesce(e.cant_cena, 1) else 0 end)
$$;

-- Saldos de todos los clientes del negocio de quien consulta
create or replace function saldos() returns table (cliente_id uuid, pagado bigint, consumido bigint, saldo bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
         coalesce(p.total, 0),
         coalesce(e.total, 0),
         coalesce(p.total, 0) - coalesce(e.total, 0)
  from clientes c
  left join (select cliente_id, sum(viandas) as total from pagos group by cliente_id) p on p.cliente_id = c.id
  left join (select cliente_id, sum(consumo_entrega(x)) as total from entregas x group by cliente_id) e on e.cliente_id = c.id
  where c.user_id = mi_negocio() and auth.uid() is not null
$$;

create or replace function saldo_cliente(cid uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(viandas) from pagos where cliente_id = cid), 0)
       - coalesce((select sum(consumo_entrega(x)) from entregas x where x.cliente_id = cid), 0)
$$;
revoke execute on function saldo_cliente(uuid) from public, anon, authenticated;

create or replace function cadete_del_dia(cid uuid, f date) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.cadete_id from rutas r where r.cliente_id = cid and r.fecha = f),
    (select c.cadete_id from clientes c where c.id = cid and not exists (select 1 from rutas r where r.cliente_id = cid and r.fecha = f))
  )
$$;

/* ---------- validación de cada entrega ---------- */
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
    -- las cantidades las define el dueño en la ficha del cliente
    new.cant_almuerzo := null;
    new.cant_cena := null;
  end if;

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
      raise exception 'Sin saldo: a % le quedan % viandas pagas. Cargá un pago antes de entregar.', c.nombre, greatest(disponible, 0);
    end if;
  end if;

  if new.cadete_id is null then new.cadete_id := cadete_del_dia(new.cliente_id, new.fecha); end if;
  new.registrado_por := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists entregas_validar on entregas;
create trigger entregas_validar before insert or update on entregas
  for each row execute function entregas_validar();

/* ---------- registro automático + descuento de stock ---------- */
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

drop trigger if exists entregas_despues on entregas;
create trigger entregas_despues after insert or update or delete on entregas
  for each row execute function entregas_despues();

-- Al borrar un cliente, sus entregas se borran antes que él, así el registro
-- conserva su nombre (el borrado en cascada llega cuando el cliente ya no está).
create or replace function clientes_antes_de_borrar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from entregas where cliente_id = old.id;
  return old;
end $$;

drop trigger if exists clientes_antes_de_borrar on clientes;
create trigger clientes_antes_de_borrar before delete on clientes
  for each row execute function clientes_antes_de_borrar();

/* ---------- alta de usuarios del equipo ---------- */
-- El usuario se crea primero en Supabase → Authentication → Users → Add user.
-- Después el dueño lo suma desde la app con su email y rol.
create or replace function agregar_miembro(p_email text, p_rol text, p_nombre text default '', p_cadete_id uuid default null)
returns miembros
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
  fila miembros;
begin
  if auth.uid() is null or mi_rol() <> 'dueno' then raise exception 'Solo el dueño puede sumar usuarios'; end if;
  if p_rol not in ('ayudante','cadete') then raise exception 'Rol inválido'; end if;
  if p_rol = 'cadete' and p_cadete_id is null then raise exception 'Elegí qué cadete es este usuario'; end if;
  if p_cadete_id is not null and not exists (select 1 from cadetes where id = p_cadete_id and user_id = auth.uid()) then
    raise exception 'Cadete inexistente';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No existe un usuario con el email %. Crealo primero en Supabase → Authentication → Users.', trim(p_email);
  end if;
  if uid = auth.uid() then raise exception 'Ese es tu propio usuario'; end if;
  if exists (select 1 from miembros where auth_id = uid and negocio_id <> auth.uid()) then
    raise exception 'Ese usuario ya pertenece a otro negocio';
  end if;
  if exists (select 1 from clientes where user_id = uid) then
    raise exception 'Ese usuario tiene su propio negocio cargado y no puede sumarse como %', p_rol;
  end if;
  insert into miembros (auth_id, negocio_id, email, nombre, rol, cadete_id)
  values (uid, auth.uid(), lower(trim(p_email)), coalesce(p_nombre, ''), p_rol, case when p_rol = 'cadete' then p_cadete_id end)
  on conflict (auth_id) do update set rol = excluded.rol, nombre = excluded.nombre, cadete_id = excluded.cadete_id
  returning * into fila;
  return fila;
end $$;

create or replace function mi_perfil() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'rol', mi_rol(),
    'negocio_id', mi_negocio(),
    'cadete_id', mi_cadete(),
    'nombre', (select nombre from miembros where auth_id = auth.uid())
  ) where auth.uid() is not null
$$;

revoke execute on function agregar_miembro(text, text, text, uuid) from public, anon;
grant execute on function agregar_miembro(text, text, text, uuid) to authenticated;

/* ---------- permisos (row level security) ---------- */
alter table cadetes enable row level security;
alter table miembros enable row level security;
alter table pagos enable row level security;
alter table productos enable row level security;
alter table movimientos enable row level security;
alter table rutas enable row level security;
alter table entregas_log enable row level security;
alter table app_migraciones enable row level security;

drop policy if exists "clientes propios" on clientes;
drop policy if exists "entregas propias" on entregas;
drop policy if exists "stock propio" on stock;
drop policy if exists "config propia" on negocio_config;

do $$
declare t text;
begin
  foreach t in array array['clientes','entregas','stock','negocio_config','cadetes','pagos','productos','movimientos','rutas','entregas_log','miembros'] loop
    execute format('drop policy if exists "leer" on %I', t);
    execute format('drop policy if exists "dueño escribe" on %I', t);
    execute format('drop policy if exists "dueño modifica" on %I', t);
    execute format('drop policy if exists "dueño borra" on %I', t);
  end loop;
end $$;

-- Clientes: todo el equipo lee (el cadete solo los de su ruta); solo el dueño modifica
create policy "leer" on clientes for select using (
  user_id = mi_negocio() and (
    mi_rol() <> 'cadete'
    or cadete_id = mi_cadete()
    or exists (select 1 from rutas r where r.cliente_id = clientes.id and r.cadete_id = mi_cadete() and r.fecha >= hoy_ar())
  ));
create policy "dueño escribe" on clientes for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on clientes for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on clientes for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

-- Entregas: todo el equipo lee y registra (el trigger valida fecha, ruta y saldo); solo el dueño borra
create policy "leer" on entregas for select using (user_id = mi_negocio());
create policy "dueño escribe" on entregas for insert with check (user_id = mi_negocio());
create policy "dueño modifica" on entregas for update using (user_id = mi_negocio()) with check (user_id = mi_negocio());
create policy "dueño borra" on entregas for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

-- Producción diaria de viandas: lee dueño y ayudante; modifica el dueño
create policy "leer" on stock for select using (user_id = mi_negocio() and mi_rol() <> 'cadete');
create policy "dueño escribe" on stock for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on stock for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on stock for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

-- Configuración: todo el equipo lee (nombre, dirección de la cocina); modifica el dueño
create policy "leer" on negocio_config for select using (user_id = mi_negocio());
create policy "dueño escribe" on negocio_config for insert with check (user_id = auth.uid() and mi_rol() = 'dueno');
create policy "dueño modifica" on negocio_config for update using (user_id = auth.uid() and mi_rol() = 'dueno');

-- Cadetes: todo el equipo lee; modifica el dueño
create policy "leer" on cadetes for select using (user_id = mi_negocio());
create policy "dueño escribe" on cadetes for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on cadetes for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on cadetes for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

-- Miembros: el dueño ve y quita a su equipo; cada miembro se ve a sí mismo. El alta es por agregar_miembro()
create policy "leer" on miembros for select using (negocio_id = auth.uid() or auth_id = auth.uid());
create policy "dueño modifica" on miembros for update using (negocio_id = auth.uid()) with check (negocio_id = auth.uid());
create policy "dueño borra" on miembros for delete using (negocio_id = auth.uid());

-- Pagos, productos y movimientos: lee dueño y ayudante; modifica el dueño
create policy "leer" on pagos for select using (user_id = mi_negocio() and mi_rol() <> 'cadete');
create policy "dueño escribe" on pagos for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on pagos for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on pagos for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

create policy "leer" on productos for select using (user_id = mi_negocio() and mi_rol() <> 'cadete');
create policy "dueño escribe" on productos for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno');
create policy "dueño modifica" on productos for update using (user_id = mi_negocio() and mi_rol() = 'dueno') with check (user_id = mi_negocio());
create policy "dueño borra" on productos for delete using (user_id = mi_negocio() and mi_rol() = 'dueno');

create policy "leer" on movimientos for select using (user_id = mi_negocio() and mi_rol() <> 'cadete');
create policy "dueño escribe" on movimientos for insert with check (user_id = mi_negocio() and mi_rol() = 'dueno' and tipo <> 'entrega');
create policy "dueño modifica" on movimientos for update using (user_id = mi_negocio() and mi_rol() = 'dueno' and tipo <> 'entrega') with check (user_id = mi_negocio() and tipo <> 'entrega');
create policy "dueño borra" on movimientos for delete using (user_id = mi_negocio() and mi_rol() = 'dueno' and tipo <> 'entrega');

-- Rutas: todo el equipo lee; arman y reasignan el dueño y el ayudante
create policy "leer" on rutas for select using (user_id = mi_negocio());
create policy "dueño escribe" on rutas for insert with check (user_id = mi_negocio() and mi_rol() in ('dueno','ayudante'));
create policy "dueño modifica" on rutas for update using (user_id = mi_negocio() and mi_rol() in ('dueno','ayudante')) with check (user_id = mi_negocio());
create policy "dueño borra" on rutas for delete using (user_id = mi_negocio() and mi_rol() in ('dueno','ayudante'));

-- Registro: lo leen dueño y ayudante; nadie lo modifica (lo escribe el trigger)
create policy "leer" on entregas_log for select using (user_id = mi_negocio() and mi_rol() <> 'cadete');

/* ---------- datos existentes (se aplica una sola vez) ---------- */
do $$
begin
  if not exists (select 1 from app_migraciones where nombre = 'v2') then
    update clientes set cant_cena = 1 where consumo = 'almuerzo_cena';

    -- Saldo inicial: los packs conservan lo que les queda; el resto arranca en 0
    -- (sus entregas pasadas quedan compensadas) hasta que se les cargue un pago.
    insert into pagos (user_id, cliente_id, fecha, viandas, nota, registrado_por)
    select c.user_id, c.id, hoy_ar(),
           case when c.tipo = 'pack' then c.pack_comprado else coalesce(e.total, 0) end,
           case when c.tipo = 'pack' then 'Pack cargado antes de la migración' else 'Ajuste inicial: entregas anteriores a la migración' end,
           c.user_id
    from clientes c
    left join (select cliente_id, sum(consumo_entrega(x)) as total from entregas x group by cliente_id) e on e.cliente_id = c.id
    where (case when c.tipo = 'pack' then c.pack_comprado else coalesce(e.total, 0) end) <> 0;

    insert into app_migraciones (nombre) values ('v2');
  end if;
end $$;

commit;
