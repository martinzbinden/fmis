-- Dienstplan (wiesenjournal:dienste): Admin und Vollzugriff planen und
-- tauschen, «Nur Lesen» sieht den Plan.
update roles set permissions = permissions || array['wiesenjournal:dienste:read', 'wiesenjournal:dienste:write']
where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  and not ('wiesenjournal:dienste:read' = any(permissions));

update roles set permissions = permissions || array['wiesenjournal:dienste:read']
where id = '00000000-0000-0000-0000-000000000003'
  and not ('wiesenjournal:dienste:read' = any(permissions));
