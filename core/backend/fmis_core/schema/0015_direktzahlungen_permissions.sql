-- Direktzahlungen: Abrechnungen und Angaben sind Betriebszahlen. Wer Flächen
-- bearbeiten darf, darf sie auch sehen; Mitarbeit und Nur Lesen nicht.

update roles r set permissions = (
  select array(select distinct p from unnest(r.permissions || array['fields:dz:read', 'fields:dz:write']) p order by p)
)
where 'fields:fields:write' = any(r.permissions);
