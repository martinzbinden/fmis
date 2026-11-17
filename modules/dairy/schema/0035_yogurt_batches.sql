-- Joghurt-Milch, abgeschlossener Vorgang (components/YogurtPlanner.tsx, lib/yogurtBatch.ts): Am Melkstand werden die Kühe
-- mit langem Druck als gemolken markiert, «Vorgang beenden» bestätigt die Umsetzung und speichert, welche Kühe
-- tatsächlich in die Joghurt-Milch kamen (auch dazugemolkene, nicht vorgeschlagene) samt Gehalten der Mischung.
-- cows = JSON [{animal_id, label, kg, fat_pct, protein_pct, cell_count, suggested}] als Text (wie treatment_templates.items).
create table yogurt_batches (
  id uuid primary key,
  batch_date date not null,
  target_kg numeric(6,1),
  factor numeric(3,2),
  criterion text,
  milk_kg numeric(6,1),
  fat_pct numeric(4,2),
  protein_pct numeric(4,2),
  cell_count integer,
  cows text not null default '[]',
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_yogurt_batches_date on yogurt_batches (batch_date desc);
