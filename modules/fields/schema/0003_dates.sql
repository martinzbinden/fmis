-- Vorbereitung für die spätere Erfassung von Kulturmassnahmen (Feldjournal):
-- sobald Saat-/Erntedaten je Kulturfläche erfasst werden, sollen sie hier
-- direkt landen, ohne weitere Migration. Bis dahin bleiben beide Spalten
-- leer und die Fruchtfolge-Zeitstrahl-Ansicht (pages/Rotation.tsx) rechnet
-- ersatzweise mit dem vollen Kalenderjahr (Jahr-01-01 bis Jahr-12-31).
alter table field_declarations add column start_date date;
alter table field_declarations add column end_date date;
