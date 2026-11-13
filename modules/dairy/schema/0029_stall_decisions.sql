-- Stallkalender (pages/Stall.tsx, lib/stallCalendar.ts): Entscheide zu Hinweisen, die nicht
-- von selbst aus den Daten folgen. Beispiel Lämmer, Tag 10: auf Eimer umstellen (eimer), bei der
-- Mutter aufziehen (mutter) oder später nochmals fragen (spaeter, bis `until`). Kälber, Tag 30:
-- Milchzusatz beendet (erledigt). Eine Zeile je
-- Jungtier; ein Entscheid für eine ganze Gruppe schreibt eine Zeile je Tier. Spätere Entscheide
-- zum selben Schritt ersetzen frühere (die neueste Zeile gilt, ältere bleiben im Verlauf).
create table stall_decisions (
  id uuid primary key,
  step text not null check (step in ('eimer', 'milchzusatz')),
  offspring_id uuid references birth_offspring(id),
  animal_id uuid references animals(id),
  decision text not null check (decision in ('eimer', 'mutter', 'spaeter', 'erledigt')),
  decided_on date not null,
  until date,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (animal_id is not null or offspring_id is not null)
);
create index idx_stall_decisions_animal on stall_decisions (animal_id, decided_on desc);
create index idx_stall_decisions_offspring on stall_decisions (offspring_id, decided_on desc);
