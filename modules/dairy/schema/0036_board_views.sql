-- Gespeicherte Ansichten des Dashboards (pages/Board.tsx, lib/boardViews.ts): Kartenfelder, Spalten, Sortierung,
-- Filtervorschläge und Einstellungen der Kartenwerte als ein Paket. Eigene Ansichten gelten auf allen Geräten der
-- Person (owner = E-Mail); shared = für alle Benutzer zum Abrufen sichtbar. Geändert wird nur von der Person selbst.
-- settings = JSON {Schlüssel: Text wie im localStorage} als Text (wie treatment_templates.items).
create table board_views (
  id uuid primary key,
  name text not null,
  owner text not null,
  shared boolean not null default false,
  settings text not null default '{}',
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_board_views_owner on board_views (owner);
