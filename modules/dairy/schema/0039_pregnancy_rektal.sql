-- Trächtigkeit beim Rind auch rektal untersucht («Touchieren»). Einzelbefunde ohne Durchgang tragen keine round_id
-- (gruppiert je Tag, lib/pregnancy.ts groupRounds).
alter table pregnancy_checks drop constraint if exists pregnancy_checks_method_check;
alter table pregnancy_checks add constraint pregnancy_checks_method_check
  check (method in ('auge', 'farbtupfer', 'ultraschall', 'rektal'));
