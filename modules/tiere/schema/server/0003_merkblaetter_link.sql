-- Merkblätter: Link zur Quelle mit Versionsprüfung, Art (Merkblatt oder ausfüllbares Formular) und Ausgabe
-- (backend/app/documents.py). Ersetzte Versionen bleiben gelöscht stehen (replaced_by → neue Zeile).
alter table documents add column if not exists url text;
alter table documents add column if not exists sha256 text;
-- 'merkblatt' oder 'formular' (PDF mit Formularfeldern); form_key = Formular, das FMIS selbst ausfüllt
alter table documents add column if not exists kind text not null default 'merkblatt';
alter table documents add column if not exists form_key text;
-- Ausgabe, z.B. «Auflage 2023»
alter table documents add column if not exists edition text;
alter table documents add column if not exists checked_at timestamptz;
-- 'aktuell', 'neu' (unter dem Link liegt eine andere Datei) oder 'fehler'
alter table documents add column if not exists check_status text;
alter table documents add column if not exists check_note text;
alter table documents add column if not exists replaced_by uuid;
update documents set sha256 = encode(sha256(data), 'hex') where sha256 is null;
-- frühere Themen «Vorlage …» (Begleitdokument) → Art Formular
update documents set kind = 'formular', form_key = 'begleitdokument_klauentiere', topic = 'transport' where topic = 'vorlage_begleitdokument';
update documents set kind = 'formular', form_key = 'tierliste_klauentiere', topic = 'transport' where topic = 'vorlage_tierliste';
