-- Gruppen aus dem Speicher des Lesegeräts (APR600 «Datenpools»), zum Import vorgeschlagen.
-- Der Server fragt das Gerät im Hintergrund ab (backend/app/reader_pools.py); ein Mensch
-- entscheidet in der App, ob daraus eine neue Gruppe wird oder eine bestehende ersetzt wird.
-- Importe ergänzen nur: Zeilen werden nie gelöscht, nur im Status geführt.
create table reader_pools (
  id uuid primary key,
  -- Kennung der Gruppe im Gerät
  device_group_id text not null,
  name text,
  -- Anzahl laut Gerät und Anzahl verstandener Ohrmarken
  device_count integer,
  tag_count integer not null default 0,
  -- JSON-Liste der Ohrmarken (lange Form «CH» + 12 Ziffern) und der nicht verstandenen Zeilen
  tags text not null default '[]',
  unmatched text not null default '[]',
  -- Rohantwort des Geräts (gekürzt), um ein falsch verstandenes Format am echten Gerät zu erkennen
  raw text,
  -- Name + Anzahl + Inhalt: gleicher Inhalt wird nicht nochmals vorgeschlagen
  signature text not null,
  fetched_at timestamptz not null default now(),
  -- neu | bekannt (Altbestand beim ersten Abgleich) | importiert | verworfen | ersetzt (durch neueren Stand)
  status text not null default 'neu' check (status in ('neu', 'bekannt', 'importiert', 'verworfen', 'ersetzt')),
  handled_by text,
  handled_at timestamptz,
  imported_group_id uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index reader_pools_signature on reader_pools (device_group_id, signature);
create index reader_pools_status on reader_pools (status, fetched_at desc);
