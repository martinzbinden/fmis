-- Dienste: Tierart voranstellen, Saison (nicht ganzjährig aktiv) und Zeiten je
-- Wochentag und Jahreszeit (Sommer/Winter).
--
--   animal                 Tierart, steht vor dem Namen («Kühe · Melken morgens»)
--   active_from/active_to  MM-DD: nur in diesem Zeitraum gibt es den Dienst (leer = ganzjährig;
--                          «von» nach «bis» heisst über den Jahreswechsel, z.B. 11-01 bis 03-31)
--   summer_from/summer_to  MM-DD: was als Sommer gilt (leer = 04-01 bis 10-31); sonst Winter
--   times                  JSON {"sommer":[e×7],"winter":[e×7]}, e = [Beginn in Minuten ab 00:00,
--                          Dauer in Minuten] für Mo..So oder null (= start_time/duration_min).
--                          Leer = jeden Tag start_time/duration_min.
alter table duty_types add column animal text;
alter table duty_types add column active_from text;
alter table duty_types add column active_to text;
alter table duty_types add column summer_from text;
alter table duty_types add column summer_to text;
alter table duty_types add column times text;

-- Vorlage-Dienste nach Tierart benennen (nur wo der Name noch der ursprüngliche ist;
-- feste updated_at, damit spätere Änderungen von Hand gewinnen und alle Geräte dasselbe sehen)
update duty_types set animal = 'Kühe', name = 'Melken morgens', updated_at = '2026-10-24T12:00:00Z'
  where id = 'd0000000-0000-4000-8000-000000000001' and name = 'Melken Kühe morgens' and animal is null;
update duty_types set animal = 'Kühe', name = 'Melken abends', updated_at = '2026-10-24T12:00:00Z'
  where id = 'd0000000-0000-4000-8000-000000000002' and name = 'Melken Kühe abends' and animal is null;
update duty_types set animal = 'Schafe', name = 'Melken morgens', updated_at = '2026-10-24T12:00:00Z'
  where id = 'd0000000-0000-4000-8000-000000000003' and name = 'Melken Schafe morgens' and animal is null;
update duty_types set animal = 'Schafe', name = 'Milch zur Käserei', updated_at = '2026-10-24T12:00:00Z'
  where id = 'd0000000-0000-4000-8000-000000000004' and name = 'Schafmilch Käserei' and animal is null;
update duty_types set animal = 'Hühner', name = 'Füttern und Eier', updated_at = '2026-10-24T12:00:00Z'
  where id = 'd0000000-0000-4000-8000-000000000005' and name = 'Hühner' and animal is null;
update duty_types set animal = 'Hühner', name = 'Misten', updated_at = '2026-10-24T12:00:00Z'
  where id = 'd0000000-0000-4000-8000-000000000006' and name = 'Hühner misten' and animal is null;

-- Neue Dienste: zunächst inaktiv, Uhrzeit und Saison sind Platzhalter und werden
-- in den Einstellungen eingetragen, bevor man sie aktiviert.
insert into duty_types (id, name, animal, start_time, duration_min, weekdays, color, description, active, sort_order, updated_at) values
  ('d0000000-0000-4000-8000-000000000007', 'Melken abends', 'Schafe', '17:00', 90, '1111111', '#15803d', 'Uhrzeit und Saison noch eintragen (nicht ganzjährig), dann aktivieren', false, 35, '2026-10-24T12:00:00Z'),
  ('d0000000-0000-4000-8000-000000000008', 'Weidekontrolle Riedacker', null, '08:00', 30, '1111111', '#0d9488', 'Uhrzeit noch eintragen, dann aktivieren', false, 70, '2026-10-24T12:00:00Z'),
  ('d0000000-0000-4000-8000-000000000009', 'Weidekontrolle Wyden', null, '08:30', 30, '1111111', '#0f766e', 'Uhrzeit noch eintragen, dann aktivieren', false, 80, '2026-10-24T12:00:00Z')
on conflict (id) do nothing;
