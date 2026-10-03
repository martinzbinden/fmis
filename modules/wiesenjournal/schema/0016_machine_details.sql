-- Maschinenliste ausbauen: Typenschild-Daten, Traktoren (Leistung,
-- Frontzapfwelle) und je Anbaugerät ein Standard-Traktor, der im Arbeitsplan
-- und beim Tracking vorgeschlagen wird (anpassbar). Bilder und Anleitungen
-- je Maschine in machine_files — nur die Angaben; die Datei selbst liegt
-- serverseitig in machine_file_data (schema/server/0004) und wird über
-- /wiesenjournal/files geladen (backend/app/machine_files.py).
alter table machines
  add column manufacturer text,
  add column model text,
  add column type_no text,
  add column serial_no text,
  add column year_built integer,
  add column weight_kg numeric(8,1),
  add column power_hp numeric(6,1),
  add column front_pto boolean default false,
  add column tractor_id uuid;

create table machine_files (
  id uuid primary key,
  machine_id uuid not null,
  kind text not null default 'bild' check (kind in ('bild', 'anleitung', 'dokument')),
  title text,
  filename text not null,
  content_type text not null,
  size_bytes integer,
  source_url text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table tracks add column tractor_id uuid;

insert into machines (id, name, kind, manufacturer, model, power_hp, front_pto, notes, sort_order) values
 ('71000000-0000-0000-0000-000000000101', 'John Deere 5100R', 'traktor', 'John Deere', '5100R', 100, true,
  'Betriebsanleitung online (Baureihe ab 2016): http://manuals.deere.com/omview/OMSU54549_29/toc.html
Baureihe 2008–13: http://manuals.deere.com/omview/OMAL200157_29/toc.html', 1),
 ('71000000-0000-0000-0000-000000000102', 'John Deere 1950', 'traktor', 'John Deere', '1950', 61, false,
  'Betriebsanleitung OML61586 nur gedruckt (John-Deere-Händler).', 2)
on conflict (id) do nothing;

insert into machines (id, name, kind, manufacturer, model, type_no, serial_no, year_built, weight_kg,
                      width_m, notes, tractor_id, sort_order) values
 ('71000000-0000-0000-0000-000000000002', 'Miststreuer Heywang SH60', 'miststreuer', 'Miro-Heywang', 'SH60',
  null, null, null, null, null,
  'Heywang gehört heute zu Miro (F), Schweizer Händler Vögeli-Berger. Ladevolumen gemäss Typenschild ergänzen. Mindestleistung laut Miro ca. 60 PS (SH 60 S).', '71000000-0000-0000-0000-000000000102', 20),
 ('71000000-0000-0000-0000-000000000003', 'Pflug Althaus Tierra 3', 'pflug', 'Althaus, Ersigen', 'Tierra 3',
  '151.331.221', '204 J.U.', 1998, null, null, '3-Schar-Anbau-Drehpflug. Althaus hat den Pflugbau 2000 eingestellt; Ersatzteile über Sahli AG bzw. Robert Aebi Landtechnik.',
  '71000000-0000-0000-0000-000000000101', 30),
 ('71000000-0000-0000-0000-000000000004', 'Saatkombination Maschio DS 2500 + Krummenacher EPS 5', 'saatkombination',
  'Maschio / Krummenacher', 'Kreiselegge DS 2500 (Daino DS) + Klein-Sämaschine EPS 5',
  'DS2500 / EPS 5', '999830078 (Kreiselegge) / 962259 (Sämaschine)', 1999, 710, 2.5,
  'Kreiselegge Maschio «Erpice rotante» DS2500, 710 kg (ohne Sämaschine). Aufgebaute pneumatische Klein-Sämaschine Krummenacher EPS 5 (Dietwil). Leistungsbedarf 80–90 PS (Maschio-Unterlagen 1998). Händler H.U. Mühlethaler, Unterlangenegg.',
  '71000000-0000-0000-0000-000000000101', 40)
on conflict (id) do nothing;

-- Güllefass (0015): mit dem 5100R; Vakuumfass, Verteiler von Hochdorfer.
update machines set tractor_id = '71000000-0000-0000-0000-000000000101'
where id = '71000000-0000-0000-0000-000000000001' and tractor_id is null;
update machines set manufacturer = 'Fliegl', model = 'Vakuumfass VFW', notes = 'Schleppschuhverteiler Hochdorfer 7 m', updated_at = now()
where id = '71000000-0000-0000-0000-000000000001' and notes = 'Schleppschuhverteiler 7 m';
