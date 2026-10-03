-- Auslauf (RAUS): Laufhof je Ort und Laufhofgänge je Gruppe und Tag.
--
-- - locations.laufhof: 'staendig' = Tiere kommen jederzeit in den Laufhof
--   (jeder Tag zählt als Auslauftag), 'zeitweise' = Laufhof vorhanden, die
--   Gänge werden täglich erfasst (herd_laufhof), 'keiner' = kein Laufhof.
-- - herd_laufhof: eine Zeile = Gruppe war an diesem Tag im Laufhof.
--   Weidetage ergeben sich aus herd_stays (slot 'weide') und brauchen keinen
--   Eintrag. Mehrfache Zeilen für Gruppe+Tag (zwei Geräte offline) sind
--   harmlos — gelesen wird "gibt es eine".

alter table locations add column laufhof text not null default 'keiner'
  check (laufhof in ('keiner', 'staendig', 'zeitweise'));

create table herd_laufhof (
  id uuid primary key,
  group_id uuid not null,
  entry_date date not null,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_herd_laufhof_date on herd_laufhof (entry_date, group_id);

-- Angaben vom 2026-10-03: Schafställe, Multifunktionsstall und Kälberställe
-- mit ständigem Zugang, Kuhstall und Laufstall Rinder zeitweise.
update locations set laufhof = 'staendig'
 where id in ('72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002',
              '72000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000005',
              '72000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000007',
              '72000000-0000-0000-0000-000000000008');
update locations set laufhof = 'zeitweise' where id = '72000000-0000-0000-0000-000000000004';

insert into locations (id, name, site, kind, sort_order, laufhof) values
 ('72000000-0000-0000-0000-000000000010', 'Laufstall Rinder', 'Oberer Riedacker', 'stall', 35, 'zeitweise')
on conflict (id) do nothing;
