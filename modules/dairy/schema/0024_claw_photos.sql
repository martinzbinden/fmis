-- Fotos auch zu Klauen-Untersuchungen (pages/ClawEntry.tsx): gleiche Tabelle wie die
-- Journal-Fotos (schema/0023), Bezug über claw_exam_id statt journal_id.
alter table journal_photos add column claw_exam_id uuid;
create index journal_photos_claw_exam on journal_photos (claw_exam_id);
