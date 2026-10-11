-- Vermarktung: Markt (Proviande-Wochenpreise) gegen Direktvermarktung
-- (Schlachten, Zerlegen, Verpacken beim Metzger, Verkauf ab Hof) — siehe
-- frontend/src/lib/marketing.ts und die Seite «Vermarktung».

-- Über welchen Weg ein Tier ging, und was der Metzger dafür verrechnete.
-- Bei Direktvermarktung ist total_revenue der Verkaufswert des Fleischs,
-- butcher_cost die Metzgerrechnung — der Gewinn zieht sie ab.
alter table slaughter_results add column channel text check (channel in ('markt', 'direkt'));
alter table slaughter_results add column butcher_cost numeric(8,2);

-- Proviande-Wochenpreise (Fr./kg SG, Fleischigkeit T, Fettklasse 3).
-- Gilt die jüngste Zeile mit valid_from <= Stichtag.
create table market_prices (
  id uuid primary key,
  valid_from date not null,
  la_t3 numeric(6,2) not null,
  sm_t3 numeric(6,2) not null,
  bio_premium numeric(6,2) not null default 0,
  -- Waagschein, TS-Präventionsabgabe, Abgabe Proviande je Tier (Viehabrechnung)
  fee_per_animal numeric(6,2) not null default 3.72,
  source text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Tarif des Metzgers und Kennzahlen der eigenen Direktvermarktung, aus den
-- Schlachtabrechnungen abgeleitet. Gilt die jüngste Zeile.
create table direct_marketing_settings (
  id uuid primary key,
  valid_from date not null,
  butcher text,
  fee_per_animal numeric(6,2) not null,
  fee_per_kg_carcass numeric(6,2) not null,
  meat_yield_pct numeric(5,2) not null,
  disposal_per_kg numeric(6,2) not null,
  pack_grams numeric(6,0) not null,
  fee_per_pack numeric(6,2) not null,
  sausage_share_pct numeric(5,2) not null,
  sausage_fee_per_kg numeric(6,2) not null,
  vat_pct numeric(4,2) not null default 2.6,
  meat_price_per_kg numeric(6,2) not null,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop view v_animal_economics;

-- Wie in 0001_init.sql, zusätzlich mit den Metzgerkosten der Direktvermarktung.
create view v_animal_economics as
select
  a.id as animal_id,
  a.ear_tag,
  a.status,
  a.purchase_cost,
  coalesce(m.total_medication_cost, 0) as medication_cost,
  coalesce(gc_alloc.allocated_group_cost, 0) as allocated_group_cost,
  coalesce(s.butcher_cost, 0) as butcher_cost,
  coalesce(s.total_revenue, 0) as total_revenue,
  coalesce(s.total_revenue, 0)
    - coalesce(s.butcher_cost, 0)
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
