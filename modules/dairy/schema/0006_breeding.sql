-- Abstammung, Belegungen, Geburten und Zuchtwerte — aus dem Herdebuch-Export
-- (Satzarten K01/K02/K09/K10/K11, Positionen in
-- frontend/src/lib/herdbookRecords.ts) und künftig aus der Erfassung in FMIS.
--
-- Tier-IDs ausserhalb von `animals` (Väter, KB-Stiere, Vorfahren) werden als
-- normalisierter Schlüssel geführt (frontend/src/lib/animalId.ts): dieselbe
-- Aue taucht im Export in der Langform "CH113<8 Ziffern><Prüfziffer>" auf,
-- auf der Ohrmarke aber in der Kurzform — beide ergeben denselben Schlüssel.

-- Alle bekannten Individuen inkl. betriebsfremder Vorfahren — Grundlage für
-- Stammbaum und Inzucht.
create table pedigree (
  id uuid primary key,
  animal_key text not null unique,
  ear_tag text not null,
  sire_key text,
  dam_key text,
  breed_code text,
  name text,
  birth_date date,
  sex text check (sex in ('w', 'm')),
  source text not null default 'import' check (source in ('import', 'manual')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Besamungen (Kühe, KB) und Belegungen (Schafe, Natursprung, oft als
-- Zeitraum mit einem Widder: service_date bis service_to).
create table matings (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  service_date date not null,
  service_to date,
  kind text check (kind in ('kb', 'natursprung')),
  seq integer,
  sire_key text,
  sire_ear_tag text,
  sire_name text,
  sire_breed text,
  source text not null default 'import' check (source in ('import', 'manual')),
  import_key text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_matings_animal on matings (animal_id, service_date desc);

-- Abkalbung/Ablammung (ein Ereignis je Muttertier und Datum) und ihre
-- Nachkommen (eine Zeile je Kalb/Lamm, auch tot geborene). Die Wurfgrösse
-- ergibt sich aus der Anzahl birth_offspring-Zeilen.
create table births (
  id uuid primary key,
  dam_id uuid not null references animals(id),
  birth_date date not null,
  parity integer,
  sire_key text,
  sire_ear_tag text,
  sire_name text,
  ease integer,
  conception_date date,
  source text not null default 'import' check (source in ('import', 'manual')),
  import_key text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_births_dam on births (dam_id, birth_date desc);

create table birth_offspring (
  id uuid primary key,
  birth_id uuid not null references births(id),
  ear_tag text,
  animal_key text,
  sex text check (sex in ('w', 'm')),
  stillborn boolean not null default false,
  died_24h boolean not null default false,
  birth_weight_kg numeric(5,1),
  import_key text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_birth_offspring_birth on birth_offspring (birth_id);

-- Zuchtwerte im Langformat (ein Merkmal je Zeile), damit neue Merkmale keine
-- Schemaänderung brauchen. Kühe: milk_kg, fat_kg, fat_pct, protein_kg,
-- protein_pct, scc, persistency, iset, mastitis, claw, feed_eff, …;
-- Schafe: idx_milk, idx_fat_pct, idx_protein_pct, gzw.
create table breeding_values (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  eval_date date not null,
  trait text not null,
  value numeric(8,2) not null,
  reliability integer,
  base text,
  import_key text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_breeding_values_animal on breeding_values (animal_id, eval_date desc);
