-- Nulllinie (Referenz fürs Parallelfahren) je Spur: JSON
-- {origin:{lat,lng}, headingDeg, source:'feldrand'|'bahn'|'ab', fieldId?, a?, b?}.
-- Damit sind Bahnen frühere Arbeiten wieder abrufbar und eine Fortsetzung
-- (nach Abbruch) übernimmt dieselbe Linie.
alter table tracks add column guide_ref text;
