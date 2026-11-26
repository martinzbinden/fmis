-- Begleitdokumente auf Papier (pages/Begleitdokument.tsx), z.B. wenn die TVD nicht erreichbar ist: welche Tiere wann
-- wohin, damit der Abgang später in der TVD gemeldet wird (Pendenz auf «Heute» und unter TVD, bis tvd_reported_on).
-- animals: JSON-Liste [{"id": …, "ear_tag": …}] zum Zeitpunkt des Dokuments.
create table movement_docs (
  id uuid primary key,
  doc_date date not null,
  purpose text check (purpose in ('verkauf', 'schlachtung', 'soemmerung', 'markt', 'ausstellung')),
  destination text,
  animals text not null,
  animal_count integer not null default 0,
  tvd_reported_on date,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_movement_docs_date on movement_docs (doc_date desc);
