-- Weitere Angaben aus dem SMG-Abstammungs- und Leistungsausweis (PDF,
-- frontend/src/lib/smgCertificate.ts), wie pedigree_breeding_values über den
-- Tierschlüssel (pedigree.animal_key) verknüpft — gilt für eigene Tiere und
-- für Vorfahren ausserhalb des Bestands. document_date = Stand des Ausweises;
-- ein neuerer Ausweis ersetzt die Angaben, ein älterer nur nach Rückfrage.

-- Gesundheit/Genetik und Anzahl Nachkommen: eine Zeile je Tier.
create table pedigree_info (
  id uuid primary key,
  animal_key text not null,
  color text,
  maedi_visna text,
  ccr5 text,
  scrapie text,
  parasite_resistance text,
  offspring_male integer,
  offspring_female integer,
  offspring_total integer,
  offspring_breeding text,
  document_date date,
  source text not null default 'leistungsausweis',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_pedigree_info_key on pedigree_info (animal_key);

-- Punktierungen (Altersklasse, Format, Fundament, Euter, Zitzen, Wolle, Fehler)
-- und LBE (Format, Fundament, Euter, Zitzen, Gesamtnote, Bemerkungen).
create table conformation_scores (
  id uuid primary key,
  animal_key text not null,
  score_date date not null,
  kind text not null check (kind in ('punktierung', 'lbe')),
  age_class text,
  format integer,
  fundament integer,
  udder integer,
  teats integer,
  wool integer,
  total integer,
  defects text,
  remarks text,
  document_date date,
  source text not null default 'leistungsausweis',
  import_key text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_conformation_scores_key on conformation_scores (animal_key, score_date);

-- Leistungen: Laktationen einer Mutter, ihr Mittel (mit Zwischenlammzeit),
-- Lebensleistung, Töchterleistungen eines Vaters je Laktation.
create table pedigree_performance (
  id uuid primary key,
  animal_key text not null,
  kind text not null check (kind in ('laktation', 'mittel', 'lebensleistung', 'toechter')),
  lactation_number integer,
  calving_date date,
  age text,
  test_type text,
  count integer,
  interval_days integer,
  days integer,
  milk_kg numeric(7,1),
  fat_pct numeric(4,2),
  fat_kg numeric(6,1),
  protein_pct numeric(4,2),
  protein_kg numeric(6,1),
  cell_count integer,
  persistency integer,
  document_date date,
  source text not null default 'leistungsausweis',
  import_key text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_pedigree_performance_key on pedigree_performance (animal_key);
