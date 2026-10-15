-- Maschinen, Wartung, Spuren, Güllefass und Dienstplan sind ins Modul
-- Betrieb gezogen, Herden und Standorte ins Modul Tiere (Oktober 2026).
-- Auf dem Server haben deren Migrationen die Daten vorher übernommen
-- (betrieb/schema/server/0004, tiere/schema/server/0001); auf den Geräten
-- holt sie der Sync der neuen Module. Hier: Fremdschlüssel auf Spuren
-- lösen (Verweis bleibt als id), offene Sync-Einträge der verschobenen
-- Tabellen verwerfen (Gerät; vor dem Update synchronisieren!), Tabellen
-- entfernen.
alter table fertilization_entries drop constraint if exists fertilization_entries_track_id_fkey;
alter table weed_observations drop constraint if exists weed_observations_track_id_fkey;

do $$
begin
  if to_regclass('sync_outbox') is not null then
    delete from sync_outbox where table_name in (
      'machines', 'machine_files', 'maintenance_tasks', 'maintenance_log', 'machine_todos', 'tracks', 'tank_events',
      'duty_people', 'duty_types', 'duty_skills', 'duty_absences', 'duty_shifts', 'duty_changes',
      'locations', 'herd_groups', 'herd_stays', 'herd_members', 'herd_counts', 'herd_laufhof');
  end if;
end $$;

drop table if exists machines, machine_files, maintenance_tasks, maintenance_log, machine_todos, tracks, tank_events,
  duty_people, duty_types, duty_skills, duty_absences, duty_shifts, duty_changes,
  locations, herd_groups, herd_stays, herd_members, herd_counts, herd_laufhof,
  machine_file_data, duty_feed_tokens cascade;
