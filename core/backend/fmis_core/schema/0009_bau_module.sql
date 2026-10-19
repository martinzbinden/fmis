-- Neues Modul Bauprojekte (Leitungen, Schächte, Gebäude planen und einmessen).
-- Rechte: wer Kulturen lesen bzw. bearbeiten darf, darf auch Bauprojekte
-- lesen bzw. bearbeiten.

insert into modules (key, title, enabled) values ('bau', 'Bauprojekte', true)
on conflict (key) do nothing;

update roles r set permissions = (
  select array(select distinct p from unnest(
    r.permissions
    || case when 'fields:fields:read' = any(r.permissions) then array['bau:projekte:read'] else '{}'::text[] end
    || case when 'fields:history:read' = any(r.permissions) then array['bau:history:read'] else '{}'::text[] end
    || case when 'fields:fields:write' = any(r.permissions) then array['bau:projekte:write'] else '{}'::text[] end
  ) p order by p)
);
