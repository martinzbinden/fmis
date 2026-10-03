-- Inhalt der Bilder/Anleitungen je Maschine (Angaben in machine_files, die
-- synchronisiert werden). Nur serverseitig: Dateien gehen nicht in die
-- Offline-Datenbank der Geräte, sondern werden bei Bedarf über
-- GET /wiesenjournal/files/{id} geladen. In Postgres statt im Dateisystem,
-- damit die normale Datenbanksicherung sie mitnimmt.
create table machine_file_data (
  id uuid primary key,
  data bytea not null,
  created_at timestamptz not null default now()
);
