-- Ausmerzliste, Vorschlag mit Entscheiden (pages/Culling.tsx, lib/cullingPlan.ts): je Tier höchstens eine
-- Markierung der laufenden Runde. leben = Daumen hoch (bleibt, wird ausgegraut), schlachten = Daumen runter
-- (fest auf der Liste). Die Zeile hat eine feste id je Tier (lib/cullingMarks.ts), eine neue Markierung ersetzt
-- die alte; «Neue Runde» löscht alle weich (deleted_at).
create table culling_marks (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  mark text not null check (mark in ('leben', 'schlachten')),
  marked_on date not null,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_culling_marks_animal on culling_marks (animal_id);
