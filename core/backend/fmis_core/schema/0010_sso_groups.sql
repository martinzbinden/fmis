-- Authelia-Gruppen → FMIS-Rollen. Wer sich über das Portal anmeldet und in einer
-- zugeordneten Gruppe ist, wird beim ersten Login sofort aktiv angelegt; solche
-- Nutzer (sso_managed) werden bei jeder Anmeldung nachgeführt. Eine von Hand
-- vergebene Rolle oder Sperre nimmt den Nutzer aus der Nachführung (sso_managed = false).

alter table users add column if not exists sso_managed boolean not null default false;
-- zuletzt gesehene Authelia-Gruppen (Kommaliste), damit der Admin die Namen sieht
alter table users add column if not exists sso_groups text;

create table if not exists sso_group_roles (
  group_name text not null,
  role_id uuid not null references roles(id) on delete cascade
);
create unique index if not exists sso_group_roles_name_idx on sso_group_roles (lower(group_name));
