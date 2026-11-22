-- Übergabe-Checkliste zwischen den Diensten (lib/handover.ts): Punkte wie «Kontrolle ob saugt» oder «Milch mit
-- Flasche geben», für Tiere, Tiergruppen, Jungtiere ohne Ohrmarke (provisorische Nummer) oder ohne Bezug.
-- type_id: für einen bestimmten Dienst; leer = jeder Dienst der Tierart (animal wie duty_types.animal, z.B. «Schafe»).
-- recurring: false = einmal (der nächste Dienst hakt ab), true = bei jedem Dienst von from_date bis until_date.
create table handover_items (
  id uuid primary key,
  text text not null,
  targets text not null default '[]',
  type_id uuid,
  animal text,
  from_date date not null,
  until_date date,
  recurring boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_handover_items_open on handover_items (from_date) where deleted_at is null and closed_at is null;

-- Abgehakt: je Punkt und Dienst (Tag + Diensttyp), mit kurzer Bemerkung (z.B. «150 ml getrunken»).
create table handover_checks (
  id uuid primary key,
  item_id uuid not null,
  date date not null,
  type_id uuid,
  done_by text,
  done_at timestamptz not null default now(),
  note text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_handover_checks_item on handover_checks (item_id) where deleted_at is null;
