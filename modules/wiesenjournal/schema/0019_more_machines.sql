-- Maschinenliste erweitert (Fotos vom 2026-10-04):
-- - owner: Eigentümer fremder Maschinen (Nachbar, Lohnunternehmer), null =
--   eigener Betrieb — Stunden und Kosten werden getrennt ausgewertet.
-- - neue Arten (nur Text, keine Check-Constraint): hoflader (Träger wie ein
--   Traktor), ladergeraet (Anbaugerät Hoflader, tractor_id = Standard-
--   Hoflader), aufbereiter, motormaeher (selbstfahrend), viehanhaenger,
--   verschlauchung.
-- Angaben, die auf den Fotos nicht lesbar sind (Arbeitsbreite, Typ), bleiben
-- leer und stehen in den Notizen zum Ergänzen.

alter table machines add column owner text;

insert into machines (id, name, kind, manufacturer, model, type_no, serial_no, year_built, weight_kg, power_hp, front_pto,
                      capacity, capacity_unit, width_m, owner, notes, tractor_id, sort_order) values
 -- Träger
 ('71000000-0000-0000-0000-000000000103', 'Fendt mit Frontlader', 'traktor', 'Fendt', null, null, null, null, null, null, false,
  null, null, null, 'Alfred Eymann', 'Modell und Leistung ergänzen.', null, 3),
 ('71000000-0000-0000-0000-000000000104', 'Hoflader Weidemann 1060 D/P', 'hoflader', 'Weidemann', '1060 D/P', null, null, null, null, null, false,
  null, null, null, null, 'Knicklenker-Hoflader. Anbaugeräte: Mistzange, Rundballenzange, Schaufel, Palettengabel, Transportkiste.', null, 5),
 -- Anbaugeräte Hoflader
 ('71000000-0000-0000-0000-000000000201', 'Mistzange (Dunggabel mit Niederhalter)', 'ladergeraet', null, null, null, null, null, null, null, false,
  null, null, null, null, null, '71000000-0000-0000-0000-000000000104', 60),
 ('71000000-0000-0000-0000-000000000202', 'Rundballenzange', 'ladergeraet', null, null, null, null, null, null, null, false,
  null, null, null, null, 'Für eingewickelte Silageballen.', '71000000-0000-0000-0000-000000000104', 61),
 ('71000000-0000-0000-0000-000000000203', 'Schaufel', 'ladergeraet', null, null, null, null, null, null, null, false,
  null, null, null, null, null, '71000000-0000-0000-0000-000000000104', 62),
 ('71000000-0000-0000-0000-000000000204', 'Palettengabel', 'ladergeraet', null, null, null, null, null, null, null, false,
  null, null, null, null, null, '71000000-0000-0000-0000-000000000104', 63),
 ('71000000-0000-0000-0000-000000000205', 'Transportkiste', 'ladergeraet', null, null, null, null, null, null, null, false,
  null, null, null, null, null, '71000000-0000-0000-0000-000000000104', 64),
 -- Geräte
 ('71000000-0000-0000-0000-000000000005', 'Sämaschine Aebi Roger R Spécial', 'saemaschine', 'Aebi (Roger)', 'R Spécial', null, null, null, null, null, false,
  null, null, null, null, 'Mechanische Drillmaschine mit Nachstriegel. Arbeitsbreite gemäss Typenschild ergänzen.', null, 45),
 ('71000000-0000-0000-0000-000000000006', 'Ladewagen Pöttinger Euroboss 250 T', 'ladewagen', 'Pöttinger', 'Euroboss 250 T Supermatic', null, null, null, 2700, null, false,
  16.1, 'm3', 1.8, null, 'Förderschwingen-Ladewagen. Ladevolumen 16.1 m³ nach DIN 11741, Pick-up 1.8 m, Leistungsbedarf 70–110 PS (Pöttinger).', '71000000-0000-0000-0000-000000000101', 50),
 ('71000000-0000-0000-0000-000000000007', 'Frontmähwerk Kuhn', 'maehwerk', 'Kuhn', null, null, null, null, null, null, false,
  null, null, null, null, 'Scheibenmähwerk Frontanbau (GMD …F), braucht Frontzapfwelle. Typ und Arbeitsbreite gemäss Typenschild ergänzen. Händler Schmutz Landtechnik AG.', '71000000-0000-0000-0000-000000000101', 52),
 ('71000000-0000-0000-0000-000000000008', 'Aufbereiter Kurmann K618/Twin', 'aufbereiter', 'Kurmann, Rüediswil', 'K618/Twin', 'K618/TWIN', '80790', 2001, 550, null, false,
  null, null, 1.8, null, 'Aufbereiter (Knickzetter) mit Twin-Bürstenwalze, Rechen und Bürste je 3-stufig einstellbar, Heckanbau, 540 U/min. Typenschild teils unleserlich: Eigengewicht «380/550» kg, Masch.-Nr. vermutlich 80790. Arbeitsbreite 1.8 m laut Kurmann (K618X Twin). Kurmann Technik AG, Ruswil.', '71000000-0000-0000-0000-000000000101', 54),
 ('71000000-0000-0000-0000-000000000009', 'Kreiselschwader Pöttinger (2 Kreisel)', 'schwader', 'Pöttinger', null, null, null, null, null, null, false,
  null, null, null, null, 'Zweikreiselschwader mit Mittelschwad (Top … C). Typ und Arbeitsbreite gemäss Typenschild ergänzen.', '71000000-0000-0000-0000-000000000101', 56),
 ('71000000-0000-0000-0000-000000000010', 'Sternradschwader Tonutti', 'schwader', 'Tonutti', null, null, null, null, null, null, false,
  null, null, null, null, 'Sternradschwader, gezogen. Typ und Arbeitsbreite ergänzen.', null, 57),
 ('71000000-0000-0000-0000-000000000011', 'Viehanhänger Joskin Betimax R 5000', 'viehanhaenger', 'Joskin', 'Betimax R 5000', null, null, null, null, null, false,
  null, null, null, null, 'Einachs-Viehanhänger, 5 m Ladelänge, Heckrampe, Trenngitter.', '71000000-0000-0000-0000-000000000102', 58),
 ('71000000-0000-0000-0000-000000000012', 'Motormäher Aebi', 'motormaeher', 'Aebi', null, null, null, null, null, null, false,
  null, null, null, null, 'Einachs-Motormäher mit Balkenmähwerk. Typ und Schnittbreite ergänzen.', null, 59),
 ('71000000-0000-0000-0000-000000000013', 'Gülle-Verschlauchung 125 mm', 'verschlauchung', 'Perrot (Kupplungen)', null, null, null, null, null, null, false,
  null, null, null, null, 'Schlauch mit Perrot-Kupplungen 133/125 mm (Schlauchtülle Vaterteil verzinkt, Hofer Mühlethurnen Art. 050 0442, CHF 42.80) und Schlauchbrücken für Strassenquerungen. Schlauchlänge, Pumpe und Verteiler ergänzen.', null, 48),
 ('71000000-0000-0000-0000-000000000014', 'Saatkombination Amazone Centaya 3000 Super', 'saatkombination', 'Amazone', 'Centaya 3000 Super', null, null, null, null, null, false,
  null, null, 3.0, 'Lohnunternehmer', 'Kreiselegge mit pneumatischer Säschiene, 3 m; kommt mit dem Fendt (BE-648) des Lohnunternehmers.', null, 90)
on conflict (id) do nothing;
