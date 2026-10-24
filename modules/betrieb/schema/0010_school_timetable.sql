-- Schultage aus dem Stundenplan (WebUntis, backend/app/school_timetable.py): bei der
-- Person die Klasse eintragen, der Server trägt die Schul- und ÜK-Tage als Abwesenheit
-- «schule» ein (je Tag eine Zeile, import_key = webuntis:<Person>:<Datum>). Er löscht
-- nie: fällt ein Tag aus dem Stundenplan, setzt er nur missing_since und meldet es dem
-- Büro, das selbst löscht oder behält.
alter table duty_absences drop constraint if exists duty_absences_kind_check;
alter table duty_absences add constraint duty_absences_kind_check
  check (kind in ('ferien', 'frei', 'krank', 'kurs', 'schule', 'andere'));
alter table duty_absences add column source text;
alter table duty_absences add column import_key text;
alter table duty_absences add column missing_since date;
create unique index duty_absences_import_key on duty_absences (import_key) where import_key is not null;

-- Klasse wie im Stundenplan (z.B. NHB2026/29-Ru); Halbklasse für Kurse in Halbklassen
-- (leer = noch unbekannt: diese Kurse kommen nur als Hinweis ans Büro)
alter table duty_people add column school_class text;
alter table duty_people add column school_half text check (school_half is null or school_half in ('A', 'B'));
