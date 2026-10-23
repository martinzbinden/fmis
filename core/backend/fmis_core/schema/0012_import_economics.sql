-- Importe sind dem Büro vorbehalten: neues Recht core:import:write. Alle bisherigen
-- Rollen mit Schreibrechten behalten es (Verhalten unverändert), «Mitarbeit» nicht.
-- Der Server verlangt es für den atomaren Push (?atomic=1), den jeder Import benutzt.
--
-- Wirtschaftlichkeit ist für alle sichtbar: «Mitarbeit» liest zusätzlich Ausgaben und
-- Wirtschaftlichkeit (die Seite rechnet aus Ausgaben, Futter, Medikamenten, Schlachtung).
update roles r set permissions = (
  select array(select distinct p from unnest(
    r.permissions
    || case when r.name <> 'Mitarbeit' and exists (select 1 from unnest(r.permissions) q where q like '%:write') then array['core:import:write'] else '{}'::text[] end
  ) p order by p)
);

update roles r set permissions = (
  select array(select distinct p from unnest(
    r.permissions || array['livestock:economics:read', 'livestock:expenses:read']
  ) p order by p)
) where r.name = 'Mitarbeit';
