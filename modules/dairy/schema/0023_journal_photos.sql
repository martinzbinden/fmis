-- Fotos zu Journal-Einträgen (Diagnose, Behandlung, Beobachtung): die Angaben
-- werden synchronisiert, das Bild selbst liegt nur auf dem Server
-- (schema/server/0001_journal_photo_data.sql, backend/app/photos.py). Das Gerät
-- verkleinert es vor dem Speichern (WebP), legt es im Browser-Cache ab und lädt
-- es hoch, sobald es Verbindung hat (frontend/src/lib/photos.ts). journal_id
-- ohne Fremdschlüssel: Eintrag und Foto kommen nicht zwingend im selben Push an.
create table journal_photos (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  journal_id uuid,
  case_id uuid,
  taken_at timestamptz not null,
  content_type text not null,
  size_bytes integer,
  width integer,
  height integer,
  caption text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index journal_photos_animal on journal_photos (animal_id);
create index journal_photos_journal on journal_photos (journal_id);
