-- Betriebsdaten: Nummern für Formulare, Ämter und Anrufe (z.B. kantonale
-- Betriebsnummer BE…, TVD-Betriebsnummer, Herdebuch). Von Hand erfasst; UID und
-- BUR-Nummer kommen aus dem GELAN-Import (Modul Kulturen, Tabelle farms) und
-- werden auf der Seite nur angezeigt (pages/FarmData.tsx).
create table farm_numbers (
  id uuid primary key,
  farm text,              -- Betriebsteil, z.B. «Riedacker»; leer = ganzer Betrieb
  label text not null,    -- z.B. «Betriebsnummer Kanton»
  value text not null,
  notes text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
