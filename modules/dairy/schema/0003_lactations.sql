-- Laktationsdaten pro Kuh (ADIS Satzart K04). Pro (Tier, Laktationsnummer)
-- können mehrere Zeilen mit unterschiedlicher Abschlussart existieren (roher
-- ADIS-Code, keine volle CODE.C01-Dekodierung im MVP — nur die für die
-- Anzeige relevanten Werte 8=laufend, 9=prognostiziert, 1-7=abgeschlossen
-- in verschiedenen Varianten sind funktional relevant, siehe
-- v_lactation_summary). Import: frontend/src/lib/importAdis.ts.
create table lactations (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  lactation_number integer not null,
  calving_date date,
  closure_type integer not null,
  days_in_milk integer,
  milk_kg numeric(6,0),
  fat_kg numeric(5,0),
  fat_pct numeric(4,2),
  protein_kg numeric(5,0),
  protein_pct numeric(4,2),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_lactations_animal on lactations (animal_id, lactation_number desc);

-- Genau eine "beste" Zeile pro (Kuh, Laktation): Vollabschluss > Standard-
-- abschluss > übrige abgeschlossene Varianten > laufender Stand > Prognose.
-- Basis für die "aufsummiert pro Laktation"-Ansicht.
create view v_lactation_summary as
select distinct on (l.animal_id, l.lactation_number)
  l.id as lactation_id,
  l.animal_id,
  a.ear_tag,
  a.name,
  l.lactation_number,
  l.calving_date,
  l.closure_type,
  l.days_in_milk,
  l.milk_kg,
  l.fat_kg,
  l.fat_pct,
  l.protein_kg,
  l.protein_pct,
  (l.fat_kg + l.protein_kg) as fat_protein_kg
from lactations l
join animals a on a.id = l.animal_id and a.deleted_at is null
where l.deleted_at is null
order by l.animal_id, l.lactation_number,
  case l.closure_type
    when 3 then 1
    when 2 then 2
    when 1 then 3
    when 4 then 3
    when 5 then 3
    when 6 then 3
    when 7 then 3
    when 8 then 4
    when 9 then 5
    else 6
  end;

-- ecm_kg (Energiekorrigierte Milch) und fat_protein_kg (kg Fett+Eiweiss,
-- kombiniert) ergänzt. ECM-Formel: Milch(kg) × (0.38×Fett% + 0.24×Eiweiss%
-- + 0.816) / 3.14 — Referenzwert 3.14 MJ NEL/kg ECM (Agroscope).
create or replace view v_animal_milk_current as
select distinct on (a.id)
  a.id as animal_id,
  a.ear_tag,
  a.name,
  a.status,
  mt.test_date,
  mt.milk_kg,
  mt.fat_pct,
  mt.protein_pct,
  round(mt.milk_kg * mt.fat_pct / 100, 2) as fat_kg,
  round(mt.milk_kg * mt.protein_pct / 100, 2) as protein_kg,
  round(mt.milk_kg * mt.fat_pct / 100 + mt.milk_kg * mt.protein_pct / 100, 2) as fat_protein_kg,
  round(mt.milk_kg * (0.38 * mt.fat_pct + 0.24 * mt.protein_pct + 0.816) / 3.14, 2) as ecm_kg
from animals a
join milk_tests mt on mt.animal_id = a.id and mt.deleted_at is null
where a.deleted_at is null
order by a.id, mt.test_date desc;
