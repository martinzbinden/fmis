-- Trächtigkeit in Durchgängen erfassen: zu Beginn wird festgehalten, wer untersucht
-- (z.B. Tierarzt mit Ultraschall) und mit welcher Methode. Alle Einträge eines
-- Durchgangs tragen dieselbe round_id; innerhalb davon gilt je Tier ein Ergebnis.
alter table pregnancy_checks add column round_id uuid;
alter table pregnancy_checks add column examiner text;
alter table pregnancy_checks add column method text check (method in ('auge', 'farbtupfer', 'ultraschall'));

-- Die ersten Einträge (28.10.2026) hat die erfassende Person selbst von Auge eingeschätzt:
-- je Tag und Person ein Durchgang (in pglite und Postgres gleich berechnet).
update pregnancy_checks
set round_id = md5('pregnancy-round:' || check_date::text || ':' || coalesce(created_by, ''))::uuid,
    examiner = initcap(replace(split_part(coalesce(created_by, ''), '@', 1), '.', ' ')),
    method = 'auge'
where round_id is null;

create index pregnancy_checks_round on pregnancy_checks (round_id);
