-- Umzug der Bestandsdaten aus dem Wiesenjournal (Oktober 2026), siehe
-- betrieb/schema/server/0004. Läuft vor den Wiesenjournal-Migrationen.
do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['locations', 'herd_groups', 'herd_stays', 'herd_members', 'herd_counts', 'herd_laufhof']
  loop
    if to_regclass('wiesenjournal.' || t) is null then
      continue;
    end if;
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'tiere' and c.table_name = t
      and exists (select 1 from information_schema.columns s
                  where s.table_schema = 'wiesenjournal' and s.table_name = t and s.column_name = c.column_name);
    execute format('insert into tiere.%I (%s) select %s from wiesenjournal.%I on conflict do nothing', t, cols, cols, t);
  end loop;

  if to_regclass('wiesenjournal.data_history') is not null then
    insert into tiere.data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
    select id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at
    from wiesenjournal.data_history
    where table_name in ('locations', 'herd_groups', 'herd_stays', 'herd_members', 'herd_counts', 'herd_laufhof')
    on conflict do nothing;
  end if;
end $$;
