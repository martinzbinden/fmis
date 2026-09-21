-- Registriert "dairy_schafe" als zweite Instanz des dairy-Moduls (Milchschafe,
-- eigenes Postgres-Schema, eigene pglite-DB, eigener Sync-Prefix, eigene
-- Rechte — siehe core/backend/fmis_core/module_registry.py, ModuleSpec.source)
-- und erweitert die drei Seed-Rollen aus 0001_core.sql um die neuen
-- Berechtigungen — als separate Migration, weil 0001_core.sql in bestehenden
-- Deployments bereits gelaufen ist (siehe schema_migrations). Das bestehende
-- "dairy"-Schema (Kühe) bleibt davon komplett unberührt.

insert into modules (key, title, enabled) values
  ('dairy_schafe', 'Milchleistung Schafe', true)
on conflict (key) do nothing;

update roles set permissions = permissions || array[
  'dairy_schafe:animals:read', 'dairy_schafe:animals:write',
  'dairy_schafe:milk:read', 'dairy_schafe:milk:write',
  'dairy_schafe:history:read'
]
where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
  and not ('dairy_schafe:animals:read' = any(permissions));

update roles set permissions = permissions || array[
  'dairy_schafe:animals:read',
  'dairy_schafe:milk:read',
  'dairy_schafe:history:read'
]
where id = '00000000-0000-0000-0000-000000000003'
  and not ('dairy_schafe:animals:read' = any(permissions));
