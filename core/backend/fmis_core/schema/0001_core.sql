-- Geteilte Core-Tabellen: Nutzer/Rollen/Login-Tokens/Modul-Registry. Landen
-- im Schema 'public' (siehe db.py: run_migrations() wendet diese Datei über
-- den 'public'-Pool an, VOR den Modul-Schemas). Ersetzt die vormals pro
-- Modul dreifach vorhandenen backend/schema/0001_auth.sql +
-- 0002_history_permissions.sql — EIN Login, EINE Rollenverwaltung für die
-- ganze App.
--
-- Berechtigungs-Strings sind ab jetzt modul-präfixiert (<modul>:<bereich>:
-- <aktion>, z.B. "livestock:animals:read") statt vorher nur <bereich>:
-- <aktion> — behebt einen Bug der getrennten Module: "animals:read" meinte
-- in livestock (Mastvieh) etwas anderes als in dairy (Milchkühe), beide
-- Tabellen aber denselben Permission-String.

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

-- Modul-Registry für den Laufzeit-Umschalter (siehe modules_admin.py) — wer
-- vorhanden UND aktiviert ist, wird im Frontend angezeigt/geroutet und im
-- Backend akzeptiert; Deaktivieren wirkt sofort, ohne Neustart.
create table modules (
  key text primary key,
  title text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into modules (key, title, enabled) values
  ('livestock', 'Mastplaner', true),
  ('dairy', 'Milchleistung', true),
  ('fields', 'Kulturen', true);

-- Seed-Rollen mit festen UUIDs, damit diese Migration idempotent bleibt und
-- der Bootstrap-Admin (INITIAL_ADMIN_EMAIL) eine feste Admin-Rolle referenzieren kann.
-- Vereinheitlicht aus den vormals 3x getrennten Rollensätzen: Admin/
-- Vollzugriff/Nur Lesen decken jetzt standardmässig ALLE Module ab (keine
-- echten Nutzer/Daten existieren bisher — engere, modulspezifische Rollen
-- lassen sich jederzeit über POST /admin/roles anlegen).
insert into roles (id, name, permissions) values
  ('00000000-0000-0000-0000-000000000001', 'Admin', array[
    'livestock:animals:read','livestock:animals:write',
    'livestock:groups:read','livestock:groups:write',
    'livestock:weighings:read','livestock:weighings:write',
    'livestock:medications:read','livestock:medications:write',
    'livestock:feed:read','livestock:feed:write',
    'livestock:expenses:read','livestock:expenses:write',
    'livestock:slaughter:read','livestock:slaughter:write',
    'livestock:economics:read','livestock:history:read',
    'dairy:animals:read','dairy:animals:write',
    'dairy:milk:read','dairy:milk:write',
    'dairy:history:read',
    'fields:fields:read','fields:fields:write',
    'fields:history:read',
    'core:users:manage','core:modules:manage'
  ]),
  ('00000000-0000-0000-0000-000000000002', 'Vollzugriff', array[
    'livestock:animals:read','livestock:animals:write',
    'livestock:groups:read','livestock:groups:write',
    'livestock:weighings:read','livestock:weighings:write',
    'livestock:medications:read','livestock:medications:write',
    'livestock:feed:read','livestock:feed:write',
    'livestock:expenses:read','livestock:expenses:write',
    'livestock:slaughter:read','livestock:slaughter:write',
    'livestock:economics:read','livestock:history:read',
    'dairy:animals:read','dairy:animals:write',
    'dairy:milk:read','dairy:milk:write',
    'dairy:history:read',
    'fields:fields:read','fields:fields:write',
    'fields:history:read'
  ]),
  ('00000000-0000-0000-0000-000000000003', 'Nur Lesen', array[
    'livestock:animals:read','livestock:groups:read','livestock:weighings:read',
    'livestock:medications:read','livestock:feed:read','livestock:expenses:read',
    'livestock:slaughter:read','livestock:economics:read','livestock:history:read',
    'dairy:animals:read','dairy:milk:read','dairy:history:read',
    'fields:fields:read','fields:history:read'
  ]);
