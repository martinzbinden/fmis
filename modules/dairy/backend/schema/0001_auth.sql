-- Nutzer/Rollen/Login-Tokens. Bewusst NICHT Teil von schema/*.sql (dem
-- geteilten Schema, das auch client-seitig in pglite läuft) — diese Daten
-- gehören nicht auf jedes Gerät repliziert, nur serverseitig relevant.

create table roles (
  id uuid primary key,
  name text not null unique,
  permissions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  email text not null unique,
  role_id uuid references roles(id),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Kurzlebige, einmalige Magic-Link-Tokens (Hash, nicht der Klartext-Token).
-- Die daraus resultierende Session ist ein stateless JWT (kein Eintrag hier).
create table login_tokens (
  id uuid primary key,
  user_id uuid not null references users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Seed-Rollen mit festen UUIDs, damit diese Migration idempotent bleibt und
-- der Bootstrap-Admin (INITIAL_ADMIN_EMAIL) eine feste Admin-Rolle referenzieren kann.
insert into roles (id, name, permissions) values
  ('00000000-0000-0000-0000-000000000001', 'Admin',
   array['animals:read','animals:write','milk:read','milk:write','users:manage']),
  ('00000000-0000-0000-0000-000000000002', 'Vollzugriff',
   array['animals:read','animals:write','milk:read','milk:write']),
  ('00000000-0000-0000-0000-000000000003', 'Nur Lesen',
   array['animals:read','milk:read']);
