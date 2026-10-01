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
-- Requiere migracion-v5.sql. Se puede volver a correr sin problema.
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
