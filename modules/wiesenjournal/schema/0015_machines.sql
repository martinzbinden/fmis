-- Maschinenliste: Fassgrösse/Ladevolumen und Arbeitsbreite für Arbeitsplan
-- (pages/WorkPlan.tsx: wie viele Fässer, welche Breite für die GPS-Spur)
-- und für "Tracking starten". tracks.machine bleibt als Freitext (Anzeige,
-- ältere Tracks); machine_id verknüpft neue Tracks mit dieser Liste.
create table machines (
  id uuid primary key,
  name text not null,
  kind text not null default 'andere',
  capacity numeric(8,2),
  capacity_unit text check (capacity_unit in ('m3', 't', 'kg')),
  width_m numeric(5,2),
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

insert into machines (id, name, kind, capacity, capacity_unit, width_m, notes, sort_order) values
 ('71000000-0000-0000-0000-000000000001', 'Güllefass Fliegl 6.5 m³', 'guellefass', 6.5, 'm3', 7,
  'Schleppschuhverteiler 7 m', 10)
on conflict (id) do nothing;

alter table tracks add column machine_id uuid;
