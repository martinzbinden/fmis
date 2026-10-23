-- Rolle «Mitarbeit» (Authelia-Gruppe riedackerhof-staff) und zwei neue Rechte.
--
--  core:korrektur:write      Einträge nachträglich ändern/stornieren. Ohne dieses Recht
--                            geht das nur in den ersten 10 Minuten nach dem Eintrag
--                            (Erfassungstabellen, siehe FRIST_TABLES in den Modulen).
--  betrieb:wuensche:read/write  Freiwünsche und Vorschläge (Abgabe, Tausch) im Dienstplan.
--                            Der Plan selbst bleibt bei betrieb:dienste:write (Büro).
--
-- Bestehende Rollen behalten ihr Verhalten: alle Rollen mit irgendeinem
-- Schreibrecht bekommen core:korrektur:write.

update roles r set permissions = (
  select array(select distinct p from unnest(
    r.permissions
    || case when exists (select 1 from unnest(r.permissions) q where q like '%:write') then array['core:korrektur:write'] else '{}'::text[] end
    || case when 'betrieb:dienste:read' = any(r.permissions) then array['betrieb:wuensche:read'] else '{}'::text[] end
    || case when 'betrieb:dienste:write' = any(r.permissions) then array['betrieb:wuensche:write'] else '{}'::text[] end
  ) p order by p)
);

-- Mitarbeit: alltägliche Erfassungen bei Land und Tieren. Der Dienstplan ist
-- nur lesbar (Wünsche und Vorschläge ausgenommen); Flächen/Parzellen, Bau,
-- Ausgaben, Wirtschaftlichkeit und die Verwaltung gehören dem Büro.
insert into roles (id, name, permissions) values
  ('00000000-0000-0000-0000-000000000004', 'Mitarbeit', array[
    'livestock:animals:read','livestock:animals:write',
    'livestock:groups:read','livestock:groups:write',
    'livestock:weighings:read','livestock:weighings:write',
    'livestock:medications:read','livestock:medications:write',
    'livestock:feed:read','livestock:feed:write',
    'livestock:slaughter:read','livestock:history:read',
    'dairy:animals:read','dairy:animals:write',
    'dairy:milk:read','dairy:milk:write','dairy:history:read',
    'dairy_schafe:animals:read','dairy_schafe:animals:write',
    'dairy_schafe:milk:read','dairy_schafe:milk:write','dairy_schafe:history:read',
    'fields:fields:read','fields:history:read',
    'wiesenjournal:parcels:read',
    'wiesenjournal:weide:read','wiesenjournal:weide:write',
    'wiesenjournal:nutzung:read','wiesenjournal:nutzung:write',
    'wiesenjournal:duengung:read','wiesenjournal:duengung:write',
    'wiesenjournal:tagesmeldung:read','wiesenjournal:tagesmeldung:write',
    'wiesenjournal:tracking:read','wiesenjournal:tracking:write',
    'wiesenjournal:history:read',
    'tiere:herden:read','tiere:herden:write','tiere:history:read',
    'betrieb:dienste:read','betrieb:wuensche:read','betrieb:wuensche:write',
    'betrieb:tracking:read','betrieb:tracking:write','betrieb:history:read',
    'bau:projekte:read','bau:history:read'
  ])
on conflict (name) do nothing;
