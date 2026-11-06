-- Ohrmarken-Vorrat aus dem TVD-Lagerbestand (lib/earTagStock.ts): unbenutzte Marken je Herde,
-- für den Vorschlag beim Nachtragen (pages/EarTagPending.tsx). Importe löschen nie: Jede Liste
-- setzt bei ihren Marken stock_date; aktuell ist, was im neuesten Stand vorkommt.
create table ear_tag_stock (
  id uuid primary key,
  ear_tag text not null,
  animal_key text not null,
  tag_type text,
  stock_date date not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_ear_tag_stock_key on ear_tag_stock (animal_key);
