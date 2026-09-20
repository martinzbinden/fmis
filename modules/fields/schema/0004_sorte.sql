-- Sorte (Kulturvariante, z.B. Weizensorte) — optional, meist erst bekannt
-- sobald Kulturmassnahmen (Aussaat) erfasst werden. Wie start_date/end_date
-- (schema/0003_dates.sql) bewusst schon jetzt angelegt, damit eine künftige
-- Erfassung ohne weitere Migration direkt landet; bis dahin bleibt die
-- Spalte leer und die Fruchtfolge-Ansicht zeigt einfach keine Sortenzeile.
alter table field_declarations add column sorte text;
