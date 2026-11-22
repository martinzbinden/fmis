-- Anbindung an den Shop (pi-pos), backend/app/shop.py. Nur auf dem Server: Adresse und Zugangsschlüssel gehören nie
-- auf die Geräte. Eine Zeile.
--   variants   JSON-Liste der Varianten-ids, deren bestätigte Anfragen eine Arbeit auslösen
create table shop_link (
  id boolean primary key default true check (id),
  base_url text,
  host text,
  token text,
  variants text not null default '[]',
  poll_minutes integer not null default 10,
  last_poll_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Welche Anfrage zu welcher Arbeit wurde (work_tasks.source = 'shop', source_ref = Anfrage-id).
create table shop_requests (
  request_id text primary key,
  task_id uuid not null,
  public_code text,
  status text,
  delivery_note_no text,
  seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
