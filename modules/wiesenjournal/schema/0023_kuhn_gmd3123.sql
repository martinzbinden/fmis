-- Frontmähwerk (Fotos 2026-10-04): Typ vom Betrieb genannt, Daten von Kuhn
-- (GMD 3123 F-FF: 3.10 m, 745 kg, 7 Scheiben, Zapfwelle 1000 U/min).
update machines set
  model = 'GMD 3123 F-FF', width_m = 3.10, weight_kg = 745,
  notes = 'Scheibenmähwerk Frontanbau, 7 Scheiben (OPTIDISC Elite), Schwadbreite 1.30–1.40 m, Schnitthöhe 35–65 mm, Zapfwelle 1000 U/min, Leistungsbedarf ab 43 PS. Händler Schmutz Landtechnik AG.',
  updated_at = now()
where id = '71000000-0000-0000-0000-000000000007' and model is null;
