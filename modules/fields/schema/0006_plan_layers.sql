create table plan_layers (
  id uuid primary key,
  name text not null,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table plan_parcels add column layer_id uuid references plan_layers(id);

insert into plan_layers (id, name, updated_at)
values ('00000000-0000-0000-0000-000000000001', 'Planung', now());

update plan_parcels set layer_id = '00000000-0000-0000-0000-000000000001'
where layer_id is null;

alter table plan_parcels alter column layer_id set not null;

drop index idx_plan_parcels_current;
create index idx_plan_parcels_current on plan_parcels (layer_id, farm_id, jahr) where is_current;

-- v_plan_parcels_current wurde in 0005 als "select *" angelegt, BEVOR
-- layer_id existierte — Postgres friert die Spaltenliste einer "select *"-
-- View beim Anlegen ein, neue Tabellenspalten erscheinen dort nicht
-- automatisch. Deshalb hier neu anlegen, jetzt inklusive layer_id.
drop view v_plan_parcels_current;
create view v_plan_parcels_current as
select * from plan_parcels where is_current and deleted_at is null;
