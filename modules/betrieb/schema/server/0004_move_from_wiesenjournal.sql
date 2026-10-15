-- Umzug der Bestandsdaten aus dem Wiesenjournal (Oktober 2026): alle Zeilen,
-- deren Verlauf (data_history), Datei-Inhalte und Kalender-Links. Läuft vor
-- den Wiesenjournal-Migrationen (Reihenfolge in module_registry.py), die
-- danach die alten Tabellen entfernen (wiesenjournal/schema/0027). Kopiert
-- nur Spalten, die es in beiden Tabellen gibt; bestehende ids bleiben
-- (on conflict do nothing). Ohne Quelltabellen (neue Installation) leer.
do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['machines', 'machine_files', 'maintenance_tasks', 'maintenance_log', 'machine_todos',
                           'tracks', 'tank_events', 'duty_people', 'duty_types', 'duty_skills', 'duty_absences',
                           'duty_shifts', 'duty_changes', 'machine_file_data', 'duty_feed_tokens']
  loop
    if to_regclass('wiesenjournal.' || t) is null then
      continue;
    end if;
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'betrieb' and c.table_name = t
      and exists (select 1 from information_schema.columns s
                  where s.table_schema = 'wiesenjournal' and s.table_name = t and s.column_name = c.column_name);
    execute format('insert into betrieb.%I (%s) select %s from wiesenjournal.%I on conflict do nothing', t, cols, cols, t);
  end loop;

  if to_regclass('wiesenjournal.data_history') is not null then
    insert into betrieb.data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
    select id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at
    from wiesenjournal.data_history
    where table_name in ('machines', 'machine_files', 'maintenance_tasks', 'maintenance_log', 'machine_todos',
                         'tracks', 'tank_events', 'duty_people', 'duty_types', 'duty_skills', 'duty_absences',
                         'duty_shifts', 'duty_changes')
    on conflict do nothing;
  end if;
end $$;
