-- Mail-Abruf für FMIS (core/backend/fmis_core/mailbox.py): ein Postfach (z.B. fmis@…), aus dem der Server Mails
-- holt und an die Module verteilt (z.B. FERTALYS-Resultate → Trächtigkeit Rindvieh). Zugangsdaten sind
-- Einstellungen der Instanz, nie im Repo; das Passwort wird nie wieder ausgegeben. Das Postfach wird nur gelesen.
create table mail_link (
  id boolean primary key default true check (id),
  host text,
  port integer not null default 993,
  username text,
  password text,
  folder text not null default 'INBOX',
  -- erlaubte Absender: Adressen oder «@domain»
  senders text not null default '[]',
  poll_minutes integer not null default 30,
  last_poll_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Verarbeitete Mails (je Message-ID nur einmal), mit Ergebnis des Moduls.
create table mail_inbox (
  message_id text primary key,
  handler text not null,
  received_at timestamptz,
  mail_date date,
  sender text,
  subject text,
  saved integer not null default 0,
  -- Hinweise des Moduls (z.B. Zeilen ohne Tier), JSON-Liste
  problems text not null default '[]',
  processed_at timestamptz not null default now()
);
