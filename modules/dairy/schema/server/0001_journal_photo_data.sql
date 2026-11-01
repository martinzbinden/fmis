-- Bildinhalt der Journal-Fotos (schema/0023) nur auf dem Server; Geräte laden
-- ihn bei Bedarf (backend/app/photos.py). Eine id ändert ihren Inhalt nie.
create table journal_photo_data (
  id uuid primary key,
  data bytea not null,
  content_type text not null,
  created_by text,
  created_at timestamptz not null default now()
);
