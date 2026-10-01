-- ============================================================
-- Migración v9 de la app de Viandas — avisos de renovación
--   · Se anota cuándo se le avisó por WhatsApp a un pack que se queda sin
--     créditos, para no avisarle dos veces. Lo pueden anotar el dueño y el
--     ayudante.
--   · Al cargarle créditos, el aviso se borra solo: la próxima vez que se
--     quede sin, arranca como "sin avisar".
--
-- Cómo usarlo: Supabase → SQL Editor → pegar todo → Run.
-- Requiere migracion-v8.sql. Se puede volver a correr sin problema.
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
