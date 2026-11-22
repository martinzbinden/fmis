-- Fotos zu Arbeiten und Betriebsjournal (lib/photos in core, backend/app/photos.py). Hier nur die Angaben (klein,
-- per Sync auf jedem Gerät); Foto und Vorschau liegen als Dateien auf dem Server (core photo_files.py), nicht in der
-- Datenbank und nicht in deren Sicherung.
-- ref_kind/ref_id: wozu das Foto gehört, z.B. 'work_task' + Arbeit, 'farm_journal' + Eintrag.
-- archived_at: Datei ausgelagert (altes Jahr archiviert), die Angaben bleiben.
create table photos (
  id uuid primary key,
  ref_kind text not null,
  ref_id uuid not null,
  taken_at timestamptz not null,
  content_type text not null,
  size_bytes integer,
  width integer,
  height integer,
  caption text,
  created_by text,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_photos_ref on photos (ref_id) where deleted_at is null;
