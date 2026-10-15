-- Geheime Links für das Kalender-Abo der Dienste (nur Server, nicht
-- synchronisiert): je Link eine Person oder alle Dienste (person_id leer).
create table duty_feed_tokens (
  token text primary key,
  person_id uuid,
  created_by text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
