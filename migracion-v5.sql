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
-- Requiere migracion-v4.sql. Se puede volver a correr sin problema.
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
