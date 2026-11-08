-- Proviande-Wochenpreise (backend/app/proviande.py holt sie automatisch): eine Zeile je Woche,
-- Kategorie und Fleischigkeit, Preise Fettklasse 3 (ohne Abzug). Importe ergänzen nur.
create table proviande_prices (
  id uuid primary key,
  valid_from date not null,
  week text not null,
  -- LA SM WP (Schafe), MT OB RG KV VK MA JB (Rindvieh)
  category text not null,
  -- C H + T - A X
  fleshiness text not null,
  price_sg numeric(6,2),
  price_lg numeric(6,2),
  source text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index proviande_prices_key on proviande_prices (valid_from, category, fleshiness);
