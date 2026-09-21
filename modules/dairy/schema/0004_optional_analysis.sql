-- Wägungen ohne Laboranalyse (nur kg Milch, kein Fett/Eiweiss — kommt im
-- Herdebuch-Export regelmässig vor, z.B. bei Nachwägungen oder wenn die
-- Probe nicht analysiert wurde) waren bisher nicht speicherbar (NOT NULL)
-- und wurden beim Import übersprungen. Jetzt zulassen; die Auswertungen
-- kennzeichnen sie über has_analysis und können sie wahlweise ausblenden.
-- Läuft identisch in Postgres und pglite (siehe db/pglite.ts).

alter table milk_tests alter column fat_pct drop not null;
alter table milk_tests alter column protein_pct drop not null;

-- Neueste Wägung pro Tier — egal ob analysiert. Alle abgeleiteten kg-Werte
-- sind bei fehlender Analyse null (SQL-Nullpropagation), has_analysis
-- macht das explizit für die UI.
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
  round(mt.milk_kg * (0.38 * mt.fat_pct + 0.24 * mt.protein_pct + 0.816) / 3.14, 2) as ecm_kg,
  (mt.fat_pct is not null and mt.protein_pct is not null) as has_analysis
from animals a
join milk_tests mt on mt.animal_id = a.id and mt.deleted_at is null
where a.deleted_at is null
order by a.id, mt.test_date desc;

-- Neueste ANALYSIERTE Wägung pro Tier — für den Filter "nur mit
-- Laboranalyse": dann soll pro Tier nicht die Zeile verschwinden, sondern
-- die letzte Wägung mit Fett/Eiweiss gezeigt werden.
create view v_animal_milk_current_analysed as
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
  round(mt.milk_kg * (0.38 * mt.fat_pct + 0.24 * mt.protein_pct + 0.816) / 3.14, 2) as ecm_kg,
  true as has_analysis
from animals a
join milk_tests mt on mt.animal_id = a.id and mt.deleted_at is null
  and mt.fat_pct is not null and mt.protein_pct is not null
where a.deleted_at is null
order by a.id, mt.test_date desc;
