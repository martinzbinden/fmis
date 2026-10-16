-- Saatangaben zu einem Saat-/Übersaat-Eintrag (1:1, id = usage_entries.id).
-- Saatmenge kg/ha bleibt in usage_entries.value_num, Mischung/Kultur in
-- usage_entries.label. Umrechnungen siehe frontend/src/lib/sowing.ts.
create table if not exists sowing_details (
  id uuid primary key,
  variety text,                 -- Sorte
  tkg_g numeric,                -- Tausendkorngewicht
  germination_pct numeric,      -- Keimfähigkeit (Etikett)
  seeds_m2 numeric,             -- Saatstärke: keimfähige Körner/m²
  emergence_pct numeric,        -- erwarteter Feldaufgang
  row_spacing_cm numeric,       -- Reihenabstand
  wide_row_every integer,       -- Hasengasse/weite Reihe: jede n-te Reihe geschlossen
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (wide_row_every is null or wide_row_every >= 2)
);
