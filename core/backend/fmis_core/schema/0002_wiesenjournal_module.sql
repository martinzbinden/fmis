-- Registriert das neue Wiesenjournal-Modul und erweitert die drei
-- Seed-Rollen aus 0001_core.sql um die neuen Berechtigungen — als separate
-- Migration, weil 0001_core.sql in bestehenden Deployments bereits gelaufen
-- ist (siehe schema_migrations).

insert into modules (key, title, enabled) values
  ('wiesenjournal', 'Wiesenjournal', true)
on conflict (key) do nothing;

update roles set permissions = permissions || array[
  'wiesenjournal:parcels:read', 'wiesenjournal:parcels:write',
  'wiesenjournal:weide:read', 'wiesenjournal:weide:write',
  'wiesenjournal:nutzung:read', 'wiesenjournal:nutzung:write',
  'wiesenjournal:duengung:read', 'wiesenjournal:duengung:write',
  'wiesenjournal:tagesmeldung:read', 'wiesenjournal:tagesmeldung:write',
  'wiesenjournal:history:read'
]
where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  and not ('wiesenjournal:parcels:read' = any(permissions));

update roles set permissions = permissions || array[
  'wiesenjournal:parcels:read',
  'wiesenjournal:weide:read',
  'wiesenjournal:nutzung:read',
  'wiesenjournal:duengung:read',
  'wiesenjournal:tagesmeldung:read',
  'wiesenjournal:history:read'
]
where id = '00000000-0000-0000-0000-000000000003'
  and not ('wiesenjournal:parcels:read' = any(permissions));
