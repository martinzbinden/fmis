-- Abwesenheiten im Kalender: Mitarbeitende tragen «krank» direkt ein; Ferien, Frei
-- und Kurs beantragen sie (duty_requests kind 'wunsch' mit absence_kind), das Büro
-- bestätigt. Leer = 'frei' (bisherige Freiwünsche).
alter table duty_requests add column absence_kind text
  check (absence_kind is null or absence_kind in ('ferien', 'frei', 'krank', 'kurs', 'andere'));
