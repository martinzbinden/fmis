-- Geburtsmeldung an die TVD (pages/TvdBirths.tsx): FMIS meldet nicht selbst, die Seite bereitet die Liste
-- für das Agate-Portal vor. Das Datum hält fest, wann ein Nachkomme dort gemeldet wurde (leer = offen).
alter table birth_offspring add column tvd_reported_on date;
