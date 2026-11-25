-- Merkblätter im Modul Tiere (z.B. Nutztiertransporte): PDFs und Bilder, die der Betrieb selbst hochlädt.
-- Nur auf dem Server (nicht synchronisiert, nicht im Repo): Liste und Inhalt holt das Gerät bei Bedarf
-- (backend/app/documents.py). Fremde Dokumente gehören nicht ins öffentliche Repo.
create table if not exists documents (
  id uuid primary key,
  title text not null,
  filename text not null,
  content_type text not null,
  size_bytes integer not null,
  data bytea not null,
  -- Herkunft / Herausgeber, frei (z.B. «INFORAMA 2018»)
  source text,
  -- Stichwort, über das andere Seiten ein Merkblatt finden (z.B. «transport» für die Tiergruppen)
  topic text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);
