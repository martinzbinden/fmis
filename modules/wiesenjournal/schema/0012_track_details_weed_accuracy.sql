-- Tracking starten fragte bisher nur label/width_m ab (beide meist leer) —
-- jetzt zusätzlich Arbeitsart/Maschine/Bediener, siehe components/
-- StartTrackDialog.tsx. Kein CHECK auf work_type: überschneidet sich nur
-- teilweise mit usage_entries.usage_type (Feldarbeit) bzw. duengung_code
-- (Düngung) — beides eigene, spezifischere Vokabulare; work_type bleibt
-- bewusst freier Text mit Vorschlagsliste in der UI.
alter table tracks add column work_type text;
alter table tracks add column machine text;
alter table tracks add column operator text;

-- Unkrautmeldung: bisher wurde die vom Browser gelieferte GPS-Genauigkeit
-- gar nicht gespeichert — jetzt sicht- und nachvollziehbar (siehe
-- components/WeedForm.tsx "±Nm").
alter table weed_observations add column accuracy_m numeric(6,2);
