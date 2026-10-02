// Anzeigenamen der Zuchtwert-Merkmale (Schlüssel aus lib/herdbookRecords.ts).
export const TRAIT_LABEL: Record<string, string> = {
  milk_kg: 'Milch kg',
  fat_kg: 'Fett kg',
  fat_pct: 'Fett %',
  protein_kg: 'Eiweiss kg',
  protein_pct: 'Eiweiss %',
  scc: 'Zellzahl',
  milk_value: 'Milchwert',
  persistency: 'Persistenz',
  iset: 'ISET (Gesamt)',
  feed_eff: 'Futtereffizienz',
  mastitis: 'Mastitisresistenz',
  claw: 'Klauengesundheit',
  idx_milk: 'Milchmenge',
  idx_fat_pct: 'Fett %',
  idx_protein_pct: 'Eiweiss %',
  gzw: 'GZW (Gesamt)',
}

/** Reihenfolge in der Anzeige: Gesamtwert zuerst. */
export const TRAIT_ORDER = [
  'gzw', 'iset', 'idx_milk', 'idx_fat_pct', 'idx_protein_pct', 'milk_kg', 'fat_kg', 'fat_pct',
  'protein_kg', 'protein_pct', 'scc', 'mastitis', 'claw', 'persistency', 'milk_value', 'feed_eff',
]
