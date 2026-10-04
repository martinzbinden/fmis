-- Fahrhilfe (components/DriveAssist.tsx): Behälter-Ereignisse auch für
-- Streuer in kg/t — tank_events.volume_m3 ist dann die Menge in `unit`.
alter table tank_events add column unit text not null default 'm3' check (unit in ('m3', 't', 'kg'));
