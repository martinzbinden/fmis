-- Trächtigkeitsdauer wahlweise in Tagen erfassen (Wahl je Durchgang). Gespeichert wird
-- weiterhin in weeks (Tage / 7); duration_unit sagt, wie der Wert erfasst und angezeigt wird.
alter table pregnancy_checks add column duration_unit text check (duration_unit in ('wochen', 'tage'));
