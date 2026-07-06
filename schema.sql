-- ============================================================
-- Esquema de base de datos para la app de Viandas
-- Cómo usarlo: Supabase → tu proyecto → SQL Editor → pegar todo
-- este archivo → Run. Se puede ejecutar una sola vez.
-- ============================================================

create extension if not exists "pgcrypto";

create table clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  nombre text not null,
  tipo text not null default 'casual',
  empresa_nombre text default '',
  consumo text not null default 'almuerzo',
  pack_comprado integer not null default 0,
  telefono text default '',
  notas text default '',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table entregas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  fecha date not null,
  almuerzo text,
  cena text,
  created_at timestamptz not null default now(),
  unique (cliente_id, fecha)
);

create table stock (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  fecha date not null,
  preparadas integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, fecha)
);

create table negocio_config (
  user_id uuid primary key default auth.uid(),
  nombre text not null default 'Mi Vianda'
);

-- Seguridad a nivel de fila: cada usuario solo ve y modifica sus propios datos
alter table clientes enable row level security;
alter table entregas enable row level security;
alter table stock enable row level security;
alter table negocio_config enable row level security;

create policy "clientes propios" on clientes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "entregas propias" on entregas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "stock propio" on stock
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "config propia" on negocio_config
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
