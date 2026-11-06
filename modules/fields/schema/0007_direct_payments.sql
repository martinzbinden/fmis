-- Direktzahlungen (frontend/src/lib/directPayments.ts): Angaben je Betrieb und Jahr
-- und die Zeilen der kantonalen Abrechnungen. Beides Betriebszahlen: eigenes Recht
-- fields:dz (backend/app/tables.py) und kein Eintrag in data_history, den die
-- Rolle Mitarbeit lesen könnte.

-- Null heisst: aus der jüngsten Abrechnung ableiten. q2 = JSON {lineage_id: Aren bzw. Bäume}.
create table dp_settings (
  id uuid primary key,
  farm_id uuid not null references farms(id),
  jahr integer not null,
  bio boolean,
  gmf boolean,
  rgve numeric,
  hang_18 numeric,
  hang_35 numeric,
  hang_50 numeric,
  q2 text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_dp_settings_farm on dp_settings (farm_id, jahr);

-- Je eine Detailzeile der Abrechnung; quantity, rate, factor wie dort gedruckt
-- (Aren, Bäume, GVE; Ansatz je Einheit), amount in Franken.
create table dp_statement_lines (
  id uuid primary key,
  farm_id uuid not null references farms(id),
  jahr integer not null,
  section text not null,
  label text not null,
  zone text,
  quantity numeric,
  rate numeric,
  factor numeric,
  amount numeric not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_dp_statement_lines_farm on dp_statement_lines (farm_id, jahr);
