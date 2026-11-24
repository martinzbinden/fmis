-- Trächtigkeit beim Rind auch über FERTALYS (Trächtigkeitstest aus der Milchprobe). Die Rindvieh-CH-Schnittstelle
-- (Version 4.35) liefert das Ergebnis nicht; Erfassung von Hand (Einzelbefund).
alter table pregnancy_checks drop constraint if exists pregnancy_checks_method_check;
alter table pregnancy_checks add constraint pregnancy_checks_method_check
  check (method in ('auge', 'farbtupfer', 'ultraschall', 'rektal', 'fertalys'));
