-- Entscheid Remonte (Zucht) oder Mast je Jungtier, aus der Selektionsseite
-- (frontend/src/pages/LambSelection.tsx). Eigene Tabelle statt Spalte an
-- birth_offspring/animals: Jungtiere kommen aus der Geburtserfassung, dem
-- Herdebuch-Export (K11) oder dem TVD-Tierbestand — der gemeinsame Nenner ist
-- der Tierschlüssel (lib/earTag.ts animalKey), und kein Import überschreibt
-- diese Zeilen. Bewusst ohne unique(animal_key): zwei Geräte könnten offline
-- denselben Entscheid anlegen; gelesen wird jeweils die neueste Zeile.
-- Der Mastplaner (modules/livestock) liest purpose = 'mast' lesend über die
-- gemeinsame pglite-Datenbank, um eigene Lämmer zu übernehmen.
create table lamb_selection (
  id uuid primary key,
  animal_key text not null,
  purpose text check (purpose in ('zucht', 'mast')),
  decided_on date,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_lamb_selection_key on lamb_selection (animal_key, updated_at desc);
