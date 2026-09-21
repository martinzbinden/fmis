-- OBSOLET: Demo-Daten werden durch 0009_remove_demo.sql wieder soft-gelöscht.
-- Datei bleibt, damit neue Clients dieselbe Migrationsfolge abspielen.
-- Demo-Daten für den ersten Wurf (Review vor echter Nutzung) — feste UUIDs,
-- damit diese Migration idempotent bleibt (gleiches Muster wie
-- core/backend/fmis_core/schema/0001_core.sql). Bei Bedarf einfach löschen.
insert into parcels (id, season_year, name, area_a, wiesentyp, intensitaet, base_geometry, sort_order, notes) values
  ('10000000-0000-0000-0000-000000000001', 2026, 'Vorwiese', 150.00, 'Dauerwiese, Weissklee-Raygras', 'i',
   '{"type":"Polygon","coordinates":[[[7.5985,46.9207],[7.6015,46.9207],[7.6015,46.9193],[7.5985,46.9193],[7.5985,46.9207]]]}',
   1, 'Hauptweide, angrenzend an den Stall'),
  ('10000000-0000-0000-0000-000000000002', 2026, 'Hangweide', 80.00, 'Extensive Weide', 'e', null, 2, 'Steillage, nur Schafe/Jungvieh'),
  ('10000000-0000-0000-0000-000000000003', 2026, 'Heimwiese', 120.00, 'Kunstwiese', 'wi', null, 3, null)
on conflict (id) do nothing;

insert into paddocks (id, paddock_id, version_number, is_current, parcel_id, season_year, valid_from, valid_to, animal_group, geometry, notes) values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, true,
   '10000000-0000-0000-0000-000000000001', 2026, '2026-05-01', null, '12 Milchkühe',
   '{"type":"Polygon","coordinates":[[[7.599,46.9205],[7.601,46.9205],[7.601,46.9195],[7.599,46.9195],[7.599,46.9205]]]}',
   'Deckt sich mit der Vorwiese-Parzelle')
on conflict (id) do nothing;

insert into usage_entries (id, parcel_id, entry_date, usage_type, animal_count, animal_group, paddock_version_id, notes) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-05-01', 'weide_anzahl', 12, '12 Milchkühe', '20000000-0000-0000-0000-000000000001', null),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '2026-05-03', 'eingrasen', null, null, null, 'Grasfütterung im Stall')
on conflict (id) do nothing;

insert into fertilization_entries (id, parcel_id, entry_date, duengung_code, amount, unit, gabe_number, notes) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-04-15', 'RGv', 25.00, 'm3', 1, null),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '2026-04-20', 'SM', 200.00, 'kg', 1, null)
on conflict (id) do nothing;

insert into n_dose_summary (id, parcel_id, season_year, gabe_number, guelle_verduennung, n_planned_kg, n_actual_kg) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 2026, 1, '1:1', 40.00, 38.00)
on conflict (id) do nothing;

insert into daily_farm_log (id, entry_date, laufhof_kuehe, laufhof_rinder, wetter_code, niederschlag_mm, mond_phase) values
  ('60000000-0000-0000-0000-000000000001', '2026-05-01', true, false, 'sonnig', 0.0, 'zunehmend'),
  ('60000000-0000-0000-0000-000000000002', '2026-05-02', true, true, 'bewoelkt', 3.5, 'zunehmend')
on conflict (id) do nothing;
