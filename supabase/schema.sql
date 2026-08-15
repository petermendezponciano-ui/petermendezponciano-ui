-- =============================================
-- Ferreteria IA - Esquema de base de datos
-- Ejecutar en Supabase > SQL Editor
-- =============================================

-- Extension para generar UUIDs
create extension if not exists "pgcrypto";

-- Proveedores (empresas que venden al negocio)
create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  contacto text,                -- telefono o red social
  notas text,
  created_at timestamptz not null default now()
);

-- Productos (dato base, sin precio: los precios viven en los modelos)
create table if not exists productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  marca text,
  tamano text,                  -- tamano del producto
  unidad text default 'unidad', -- unidad de medida: unidad, caja, docena...
  proveedor_id uuid references proveedores(id) on delete set null,
  foto_url text,                -- imagen del producto en Supabase Storage
  created_at timestamptz not null default now()
);

-- Modelos (varios por producto; cada uno con su propio precio y stock)
create table if not exists modelos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  nombre text not null,         -- ej: "GSB 13", "XL Pro"
  precio_costo numeric(12,2),
  precio_venta numeric(12,2),
  cantidad numeric(12,2) default 0, -- stock disponible
  created_at timestamptz not null default now()
);

-- Historial de cambios (quien/que/cuando)
create table if not exists historial_cambios (
  id uuid primary key default gen_random_uuid(),
  tabla text not null,
  registro_id uuid,
  detalle text,
  created_at timestamptz not null default now()
);

-- Indices para consultas rapidas
create index if not exists idx_productos_proveedor on productos(proveedor_id);
create index if not exists idx_modelos_producto on modelos(producto_id);

-- =============================================
-- Seguridad: Row Level Security (RLS)
-- Solo usuarios autenticados acceden
-- =============================================
alter table proveedores enable row level security;
alter table productos enable row level security;
alter table modelos enable row level security;
alter table historial_cambios enable row level security;

create policy "Acceso autenticado proveedores"
  on proveedores for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Acceso autenticado productos"
  on productos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Acceso autenticado modelos"
  on modelos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "Acceso autenticado historial"
  on historial_cambios for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- =============================================
-- Fotos de productos (Supabase Storage)
-- =============================================
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

create policy "Subir fotos autenticado"
  on storage.objects for insert
  with check (auth.role() = 'authenticated' and bucket_id = 'productos');

create policy "Actualizar fotos autenticado"
  on storage.objects for update
  using (auth.role() = 'authenticated' and bucket_id = 'productos');

create policy "Eliminar fotos autenticado"
  on storage.objects for delete
  using (auth.role() = 'authenticated' and bucket_id = 'productos');

create policy "Ver fotos autenticado"
  on storage.objects for select
  using (bucket_id = 'productos');
