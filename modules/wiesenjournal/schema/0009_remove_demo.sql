-- Demo-Zeilen aus 0003_seed_demo.sql (feste UUID-Präfixe 1000…–6000…) vor
-- dem echten Betrieb soft-löschen — aber nur, wenn sie nie über die App
-- bearbeitet wurden (dann gäbe es eine data_history-Zeile mit action <>
-- 'insert'). Soft- statt Hard-Delete, damit die Löschung per Sync auf alle
-- Clients propagiert und keine FK-Verweise reissen. Neue Clients spielen
-- 0003 und danach diese Migration ab — Ergebnis identisch.
update usage_entries set deleted_at = now(), updated_at = now()
 where id::text like '30000000-0000-0000-0000-%' and deleted_at is null
   and not exists (select 1 from data_history h where h.row_id = usage_entries.id and h.action <> 'insert');
update fertilization_entries set deleted_at = now(), updated_at = now()
 where id::text like '40000000-0000-0000-0000-%' and deleted_at is null
   and not exists (select 1 from data_history h where h.row_id = fertilization_entries.id and h.action <> 'insert');
update n_dose_summary set deleted_at = now(), updated_at = now()
 where id::text like '50000000-0000-0000-0000-%' and deleted_at is null
   and not exists (select 1 from data_history h where h.row_id = n_dose_summary.id and h.action <> 'insert');
update daily_farm_log set deleted_at = now(), updated_at = now()
 where id::text like '60000000-0000-0000-0000-%' and deleted_at is null
   and not exists (select 1 from data_history h where h.row_id = daily_farm_log.id and h.action <> 'insert');
update paddocks set deleted_at = now(), updated_at = now(), is_current = false
 where id::text like '20000000-0000-0000-0000-%' and deleted_at is null
   and not exists (select 1 from data_history h where h.row_id = paddocks.id and h.action <> 'insert');
update parcels set deleted_at = now(), updated_at = now()
 where id::text like '10000000-0000-0000-0000-%' and deleted_at is null
   and not exists (select 1 from data_history h where h.row_id = parcels.id and h.action <> 'insert')
   and not exists (select 1 from usage_entries u where u.parcel_id = parcels.id and u.deleted_at is null)
   and not exists (select 1 from fertilization_entries f where f.parcel_id = parcels.id and f.deleted_at is null);
