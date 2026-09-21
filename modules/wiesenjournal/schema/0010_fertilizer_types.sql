-- Düngerarten mit Nährstoffgehalten (Richtwerte ca. GRUD 2017, Tabelle
-- Hofdünger — Näherungen, in der App editierbar; "Richtwert, bitte prüfen").
-- Werte je Einheit (m3 bzw. t bzw. kg) beziehen sich auf den Zustand mit
-- dilution_default (Gülle-Anteil im ausgebrachten Volumen: 1:1 verdünnt =
-- 0.5, unverdünnt = 1). container_* = Fass/Fuder, damit "3 Fass" direkt als
-- Menge erfasst werden kann. legacy_code ordnet alte duengung_code-Werte zu.
create table fertilizer_types (
  id uuid primary key,
  code text not null,
  name text not null,
  unit text not null check (unit in ('m3', 't', 'kg')),
  n_kg_per_unit numeric(8,3) not null default 0,
  n_avail_pct numeric(5,1) not null default 0,
  p2o5_kg_per_unit numeric(8,3) not null default 0,
  k2o_kg_per_unit numeric(8,3) not null default 0,
  mg_kg_per_unit numeric(8,3),
  dilution_default numeric(5,3) not null default 1,
  container_label text,
  container_size numeric(8,2),
  legacy_code text,
  sort_order integer not null default 0,
  active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
insert into fertilizer_types (id, code, name, unit, n_kg_per_unit, n_avail_pct, p2o5_kg_per_unit, k2o_kg_per_unit, mg_kg_per_unit, dilution_default, container_label, container_size, legacy_code, sort_order, notes) values
 ('70000000-0000-0000-0000-000000000001','RGv','Rindergülle verdünnt 1:1','m3',2.3,60,0.9,3.5,0.4,0.5,'Fass',6.5,'RGv',10,'Richtwert ca. GRUD 2017 (TS ~3.5 %)'),
 ('70000000-0000-0000-0000-000000000002','RGk','Rindergülle unverdünnt (Vollgülle)','m3',4.6,60,1.8,7.0,0.8,1.0,'Fass',6.5,'RGk',20,'Richtwert ca. GRUD 2017 (TS ~7.5 %)'),
 ('70000000-0000-0000-0000-000000000003','RMI','Rindermist (Stapelmist)','t',5.0,25,3.0,9.5,1.1,1.0,'Fuder',null,'RMI',30,'Richtwert ca. GRUD 2017'),
 ('70000000-0000-0000-0000-000000000004','RMs','Rindermist (Laufstall/Tiefstreu)','t',5.5,25,3.0,10.0,1.2,1.0,'Fuder',null,'RMs',40,'Richtwert ca. GRUD 2017'),
 ('70000000-0000-0000-0000-000000000005','SG','Schafgülle','m3',3.5,55,1.5,6.0,0.6,1.0,'Fass',6.5,'SG',50,'Richtwert ca. GRUD 2017'),
 ('70000000-0000-0000-0000-000000000006','SM','Schafmist','t',8.0,25,4.0,13.0,1.7,1.0,'Fuder',null,'SM',60,'Richtwert ca. GRUD 2017'),
 ('70000000-0000-0000-0000-000000000007','MK','Mistkompost','t',7.0,10,5.0,11.0,3.0,1.0,'Fuder',null,null,70,'Richtwert ca. GRUD 2017 (TS ~50 %)'),
 ('70000000-0000-0000-0000-000000000008','H','Hühnermist / Legehennenkot','t',15.0,50,11.0,8.0,3.0,1.0,null,null,'H',80,'Richtwert ca. GRUD 2017 (frisch)'),
 ('70000000-0000-0000-0000-000000000009','A','Ammonsalpeter 27 %','kg',0.27,100,0,0,0,1.0,null,null,'A',90,'Handelsdünger'),
 ('70000000-0000-0000-0000-000000000010','V','NPK 15-15-15','kg',0.15,100,0.15,0.15,0,1.0,null,null,'V',100,'Handelsdünger'),
 ('70000000-0000-0000-0000-000000000011','K','Kalk','kg',0,0,0,0,0,1.0,null,null,null,110,'nur Kalkung, kein N')
on conflict (id) do nothing;
