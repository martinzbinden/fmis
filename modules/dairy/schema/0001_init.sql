-- Kanonisches Schema für das Milchleistungs-Modul.
-- Wird identisch auf dem Server-PostgreSQL und client-seitig in pglite angewendet.
-- IDs werden immer von der Anwendung als UUIDv4 erzeugt (kein DB-seitiger Default),
-- damit auch offline generierte Zeilen stabile, kollisionsfreie IDs haben.

create table animals (
  id uuid primary key,
  ear_tag text not null unique,
  name text,
  breed_code text,
  birth_date date,
  sex text check (sex in ('w', 'm')),
  status text not null default 'aktiv' check (status in ('aktiv', 'abgegangen')),
  entry_date date,
  exit_date date,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Ergebnis einer einzelnen Milchprobe (Milchleistungsprüfung, "Testtag") pro
-- Kuh. Import kommt aus dem ADIS-Herdebuch-Export (Satzart K33), siehe
-- frontend/src/lib/importAdis.ts.
create table milk_tests (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  test_date date not null,
  calving_date date,
  lactation_number integer,
  milk_kg numeric(4,1) not null,
  fat_pct numeric(4,2) not null,
  protein_pct numeric(4,2) not null,
  lactose_pct numeric(4,2),
  cell_count integer,
  urea_mg_dl integer,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Jeweils neuester Test pro Kuh, inkl. daraus berechneter kg Fett/Eiweiss
-- (Milch kg × %/100) — Basis für die "kg Fett/Eiweiss pro Kuh"-Ansicht und
-- die Joghurt-Kuhauswahl.
create view v_animal_milk_current as
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
  round(mt.milk_kg * mt.protein_pct / 100, 2) as protein_kg
from animals a
join milk_tests mt on mt.animal_id = a.id and mt.deleted_at is null
where a.deleted_at is null
order by a.id, mt.test_date desc;
