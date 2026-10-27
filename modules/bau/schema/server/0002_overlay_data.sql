-- Bilder der Grundlagen (schema/0003_overlays.sql), nur auf dem Server.
create table overlay_data (
  id uuid primary key,
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
