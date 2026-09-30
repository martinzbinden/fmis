-- Wetter/Niederschlag: künftig automatisch vom (noch nicht verfügbaren)
-- Geodatenserver befüllt, siehe pages/JournalGrid.tsx Fusszeile. Lokale
-- Eingabe in der Tabelle (DailyLogEditor) hat immer Vorrang und überschreibt
-- einen automatisch gesetzten Wert — wetter_quelle hält fest, welcher Fall
-- gerade zutrifft. Die eigentliche Geodaten-Abfrage ist hier bewusst noch
-- nicht gebaut (kein Server/API bekannt) — nur die Datenstruktur dafür.
alter table daily_farm_log add column wetter_quelle text not null default 'manuell'
  check (wetter_quelle in ('geodaten', 'manuell'));
