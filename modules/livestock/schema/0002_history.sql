-- Historisierung aller Schreiboperationen auf den übrigen Tabellen. Wird
-- ausschliesslich von upsertRow()/softDeleteRow() (frontend/src/db/write.ts)
-- automatisch mitgeschrieben, nie direkt von einem Formular befüllt.
-- snapshot ist die komplette Zeile NACH der Änderung als JSON-Text (nicht
-- jsonb — vermeidet Adapter-Klippen zwischen psycopg3 und pglite beim
-- Push/Pull). Bewusst KEIN deleted_at: das Audit-Log ist unveränderlich.
create table data_history (
  id uuid primary key,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by text,
  changed_at timestamptz not null default now(),
  snapshot text not null,
  updated_at timestamptz not null default now()
);

create index idx_data_history_row on data_history (table_name, row_id, changed_at desc);
