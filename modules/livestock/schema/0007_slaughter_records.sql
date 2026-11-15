-- Schlachtungen aller Tiere (Lämmer, Schafe, Kälber, Rinder, Kühe …) aus den Schlachtabrechnungen: eine Zeile je
-- Tier über die Ohrmarke, unabhängig davon, ob das Tier im Mastplaner steht (slaughter_results bleibt das
-- Schlachtresultat eines Masttiers). Für Auswertungen: Schlachtgewicht nach Alter, Jahreszeit, Taxation, Preis.
-- Alter und Geschlecht kommen beim Auswerten aus den Tierlisten der Module (über animal_key).
create table slaughter_records (
  id uuid primary key,
  slaughter_date date not null,
  -- Kennzeichen wie auf der Abrechnung (z.B. 9999.0001), normalisiert in animal_key (core earTag.ts animalKey)
  ear_tag text,
  animal_key text,
  -- Lamm, Schaf, Kalb, Rind, Kuh, Ziege, anderes
  category text not null,
  carcass_kg numeric(6,2),
  -- CHTAX, z.B. T2 (Fleischigkeit + Fettklasse)
  classification text,
  price_per_kg numeric(6,2),
  amount numeric(8,2),
  -- Vermerk der Abrechnung, z.B. «klein», «nass»
  remark text,
  -- Abnehmer / Schlachtbetrieb, Abrechnungs- und Waagschein-Nummer
  buyer text,
  settlement_no text,
  weigh_slip_no text,
  -- import (Abrechnung eingelesen) | manuell
  source text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index slaughter_records_animal on slaughter_records (animal_key);
create index slaughter_records_date on slaughter_records (slaughter_date);
