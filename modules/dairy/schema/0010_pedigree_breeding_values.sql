-- Zuchtwerte von Tieren ausserhalb des Bestands (Widder/Stiere, Vorfahren),
-- z.B. aus dem SMG-Abstammungs- und Leistungsausweis (PDF, frontend/src/lib/
-- smgCertificate.ts). breeding_values bleibt den eigenen Tieren vorbehalten
-- (animal_id not null, Quelle Herdebuch-Export K09); hier ist der Schlüssel
-- der normalisierte Tierschlüssel wie in pedigree.animal_key. Gleiches
-- Langformat (ein Merkmal je Zeile). import_key = animal_key|trait — es wird
-- nur der neueste Stand je Merkmal gehalten.
create table pedigree_breeding_values (
  id uuid primary key,
  animal_key text not null,
  eval_date date not null,
  trait text not null,
  value numeric(8,2) not null,
  reliability integer,
  source text not null default 'leistungsausweis',
  import_key text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_pedigree_breeding_values_key on pedigree_breeding_values (animal_key);
