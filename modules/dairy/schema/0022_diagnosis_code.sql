-- Diagnose aus der Kurzliste (frontend/src/lib/diagnoses.ts): stabiler Schlüssel wie
-- 'mastitis_akut'; die Kurzliste ordnet ihm den Code im ICAR Central Health Key zu
-- (Rinder), Schaf-Krankheiten ohne ICAR-Code haben nur den eigenen Schlüssel. Der Text in
-- diagnosis bleibt für Einzelheiten (z.B. «hinten links»). Leer = frei formuliert.
alter table animal_journal add column diagnosis_code text;
alter table treatment_templates add column diagnosis_code text;
