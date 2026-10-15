-- Neue Module Betrieb (Maschinen, Wartung, Tracking, Arbeitsplan,
-- Dienstplan) und Tiere (Herden, Standorte, Laufhof), aus dem Wiesenjournal
-- herausgelöst (Oktober 2026). Rechte werden übertragen: wer im
-- Wiesenjournal Tracking bzw. Dienste durfte, darf es im Betrieb; wer den
-- Weidegang bearbeiten durfte, darf die Herden. Unkraut-Meldungen bleiben
-- unter wiesenjournal:tracking.

insert into modules (key, title, enabled) values
  ('betrieb', 'Betrieb', true),
  ('tiere', 'Tiere', true)
on conflict (key) do nothing;

-- je Rolle die neuen Rechte aus den bisherigen ableiten
update roles r set permissions = (
  select array(select distinct p from unnest(
    r.permissions
    || case when 'wiesenjournal:tracking:read' = any(r.permissions) then array['betrieb:tracking:read', 'betrieb:history:read'] else '{}'::text[] end
    || case when 'wiesenjournal:tracking:write' = any(r.permissions) then array['betrieb:tracking:write'] else '{}'::text[] end
    || case when 'wiesenjournal:dienste:read' = any(r.permissions) then array['betrieb:dienste:read'] else '{}'::text[] end
    || case when 'wiesenjournal:dienste:write' = any(r.permissions) then array['betrieb:dienste:write'] else '{}'::text[] end
    || case when 'wiesenjournal:weide:read' = any(r.permissions) then array['tiere:herden:read', 'tiere:history:read'] else '{}'::text[] end
    || case when 'wiesenjournal:weide:write' = any(r.permissions) then array['tiere:herden:write'] else '{}'::text[] end
  ) p order by p)
);

-- Dienste gibt es im Wiesenjournal nicht mehr
update roles set permissions = array_remove(array_remove(permissions, 'wiesenjournal:dienste:read'), 'wiesenjournal:dienste:write');
