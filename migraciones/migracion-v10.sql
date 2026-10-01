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
-- Requiere migracion-v9.sql. Se puede volver a correr sin problema.
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
