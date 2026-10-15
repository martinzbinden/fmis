-- Inhalt der Maschinen-Dateien (Bilder, Anleitungen) nur auf dem Server;
-- Geräte laden ihn bei Bedarf (backend/app/machine_files.py).
create table machine_file_data (
  id uuid primary key,
  data bytea not null,
  created_at timestamptz not null default now()
);
