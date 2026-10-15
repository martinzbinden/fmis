-- Geheime Links für das Kalender-Abo der Dienste (backend/app/duty_feed.py).
create table duty_feed_tokens (
  token text primary key,
  person_id uuid,
  created_by text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
