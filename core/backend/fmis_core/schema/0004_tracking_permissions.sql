-- Erweitert die drei Seed-Rollen um die neue wiesenjournal:tracking-Area
-- (Traktor-Tracks + Unkraut-Beobachtungen — ein Bucket, da in der Praxis
-- dieselbe Person fährt und Unkraut meldet).

update roles set permissions = permissions || array[
  'wiesenjournal:tracking:read', 'wiesenjournal:tracking:write'
]
where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  and not ('wiesenjournal:tracking:read' = any(permissions));

update roles set permissions = permissions || array[
  'wiesenjournal:tracking:read'
]
where id = '00000000-0000-0000-0000-000000000003'
  and not ('wiesenjournal:tracking:read' = any(permissions));
