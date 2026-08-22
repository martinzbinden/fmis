-- Kanonisches Schema für Lämmermast-Tool.
-- Wird identisch auf dem Server-PostgreSQL und client-seitig in pglite angewendet.
-- IDs werden immer von der Anwendung als UUIDv4 erzeugt (kein DB-seitiger Default),
-- damit auch offline generierte Zeilen stabile, kollisionsfreie IDs haben.

create table animals (
  id uuid primary key,
  ear_tag text not null unique,
  birth_date date,
  sex text not null check (sex in ('m', 'w', 'k')),
  status text not null default 'aktiv' check (status in ('aktiv', 'verkauft', 'geschlachtet', 'verendet')),
  entry_date date,
  entry_weight_kg numeric(5,2),
  purchase_cost numeric(8,2) not null default 0,
  source_tvd_nr text,
  source_name text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table animal_groups (
  id uuid primary key,
  name text not null,
  created_date date not null,
  target_weight_min_kg numeric(5,2) not null default 45,
  target_weight_max_kg numeric(5,2) not null default 50,
  status text not null default 'aktiv' check (status in ('aktiv', 'abgeschlossen')),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Erlaubt Umgruppierung im Mastverlauf: ein Tier kann mehrere Mitgliedschaften
-- über die Zeit haben, end_date null = aktuelle Gruppe.
create table group_memberships (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  group_id uuid not null references animal_groups(id),
  start_date date not null,
  end_date date,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table weighings (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  date date not null,
  weight_kg numeric(5,2) not null,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- withdrawal_until wird in Queries als "date + withdrawal_days" berechnet
-- (kein generated column, um Kompatibilität zwischen Postgres und pglite nicht zu riskieren).
create table medications (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  date date not null,
  medication_name text not null,
  dose text,
  reason text,
  withdrawal_days integer not null default 0,
  administered_by text,
  cost numeric(8,2),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table feed_records (
  id uuid primary key,
  group_id uuid not null references animal_groups(id),
  date date not null,
  feed_type text not null,
  quantity numeric(8,2) not null,
  unit text not null default 'kg',
  cost_total numeric(8,2),
  supplier text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table expenses (
  id uuid primary key,
  group_id uuid not null references animal_groups(id),
  date date not null,
  category text not null,
  description text,
  amount numeric(8,2) not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table slaughter_results (
  id uuid primary key,
  animal_id uuid not null unique references animals(id),
  slaughter_date date not null,
  slaughterhouse text,
  carcass_weight_kg numeric(5,2),
  classification text,
  fat_class text,
  price_per_kg numeric(6,2),
  total_revenue numeric(8,2),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Tier-Tage pro Gruppenmitgliedschaft: Basis für die anteilige Kostenzuteilung.
create view v_animal_group_days as
select
  gm.id as membership_id,
  gm.animal_id,
  gm.group_id,
  gm.start_date,
  coalesce(gm.end_date, current_date) as effective_end_date,
  (coalesce(gm.end_date, current_date) - gm.start_date + 1) as days_in_group
from group_memberships gm
where gm.deleted_at is null;

-- Futter- und sonstige Kosten pro Gruppe, plus Summe aller Tier-Tage der Gruppe
-- (Nenner für die anteilige Zuteilung an einzelne Tiere).
create view v_group_costs as
select
  g.id as group_id,
  coalesce(f.total_feed_cost, 0) as total_feed_cost,
  coalesce(e.total_other_cost, 0) as total_other_cost,
  coalesce(f.total_feed_cost, 0) + coalesce(e.total_other_cost, 0) as total_group_cost,
  coalesce(d.total_days, 0) as total_animal_days
from animal_groups g
left join (
  select group_id, sum(cost_total) as total_feed_cost
  from feed_records where deleted_at is null group by group_id
) f on f.group_id = g.id
left join (
  select group_id, sum(amount) as total_other_cost
  from expenses where deleted_at is null group by group_id
) e on e.group_id = g.id
left join (
  select group_id, sum(days_in_group) as total_days
  from v_animal_group_days group by group_id
) d on d.group_id = g.id
where g.deleted_at is null;

-- Wirtschaftlichkeit pro Tier: Erlös minus Anschaffung, Medikamente und
-- anteilige Gruppenkosten (Futter + Sonstiges), verteilt nach Tier-Tagen.
create view v_animal_economics as
select
  a.id as animal_id,
  a.ear_tag,
  a.status,
  a.purchase_cost,
  coalesce(m.total_medication_cost, 0) as medication_cost,
  coalesce(gc_alloc.allocated_group_cost, 0) as allocated_group_cost,
  coalesce(s.total_revenue, 0) as total_revenue,
  coalesce(s.total_revenue, 0)
    - a.purchase_cost
    - coalesce(m.total_medication_cost, 0)
    - coalesce(gc_alloc.allocated_group_cost, 0) as profit
from animals a
left join slaughter_results s on s.animal_id = a.id and s.deleted_at is null
left join (
  select animal_id, sum(cost) as total_medication_cost
  from medications where deleted_at is null group by animal_id
) m on m.animal_id = a.id
left join (
  select
    d.animal_id,
    sum(
      case when gc.total_animal_days > 0
        then gc.total_group_cost * d.days_in_group / gc.total_animal_days
        else 0
      end
    ) as allocated_group_cost
  from v_animal_group_days d
  join v_group_costs gc on gc.group_id = d.group_id
  group by d.animal_id
) gc_alloc on gc_alloc.animal_id = a.id
where a.deleted_at is null;
