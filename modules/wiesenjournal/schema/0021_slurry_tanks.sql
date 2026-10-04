-- Güllefass beim GPS-Tracking (lib/slurry.ts):
-- - machines.flow_m3_min: Ausfluss des Fasses (Startwert); geeicht wird
--   laufend aus den "Fass leer"-Meldungen (tank_events).
-- - tank_events: ein Fass = eine Zeile — gemeldet per Knopf oder automatisch
--   (Feld länger verlassen), mit der in Feldrichtung gefahrenen Strecke und
--   Zeit seit dem letzten Fass; daraus Menge/ha und Ausfluss.

alter table machines add column flow_m3_min numeric(6,2);

create table tank_events (
  id uuid primary key,
  track_id uuid,
  machine_id uuid,
  parcel_id uuid,
  event_at timestamptz not null,
  source text not null default 'knopf' check (source in ('knopf', 'auto')),
  volume_m3 numeric(6,2) not null,
  distance_m numeric(8,1) not null,
  spread_s numeric(8,1) not null,
  width_m numeric(5,2) not null,
  lat double precision,
  lng double precision,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_tank_events_machine on tank_events (machine_id, event_at);
create index idx_tank_events_track on tank_events (track_id);

-- Startwert Fliegl 6.5 m³: Fass nach ca. 180 m leer bei Gang A4 / 1300 U/min
-- (≈ 3 km/h geschätzt, Zapfwelle 540) → 6.5 m³ in ≈ 3.5 min.
update machines set flow_m3_min = 1.86
where id = '71000000-0000-0000-0000-000000000001' and flow_m3_min is null;
