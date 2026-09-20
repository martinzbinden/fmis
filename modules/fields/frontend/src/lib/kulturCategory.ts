// Grobe Einordnung des amtlichen Kulturartenkatalogs anhand der Hunderter-
// Stelle des Codes — die Nummerierung selbst folgt dieser Gruppierung
// (Getreide/Ölsaaten/Eiweisspflanzen 500-599, Kunstwiesen+Dauergrünflächen
// 600-699, Spezialkulturen 700-799, Biodiversität/Hecken 800-899,
// Wald/Bäume/unproduktiv 900-999), verifiziert gegen alle in den echten
// Exporten beobachteten Codes (siehe modules/fields/README.md). Bei
// Fehlklassifikation eines konkreten Codes: hier anpassen, kein Katalog
// zum Pflegen nötig.
export type KulturCategory = 'acker' | 'futter' | 'andere'

export const KULTUR_CATEGORY_LABEL: Record<KulturCategory, string> = {
  acker: 'Offene Ackerfläche',
  futter: 'Futterfläche',
  andere: 'Andere',
}

export function classifyKultur(code: string): KulturCategory {
  const n = Number(code)
  if (!Number.isFinite(n)) return 'andere'
  if (n >= 500 && n < 600) return 'acker'
  if (n >= 600 && n < 700) return 'futter'
  return 'andere'
}

// Gehölze (mehrjährige Holzgewächse: Hochstamm-/Nussbäume, Hecken/Feld-
// gehölze, Wald) — Codes 800-999, unabhängig von classifyKultur() oben.
// Eigener Umschalter in der Fruchtfolge-Ansicht, da diese Flächen nicht
// rotieren und den Zeitstrahl sonst unnötig zumüllen.
export function isGeholz(code: string): boolean {
  const n = Number(code)
  return Number.isFinite(n) && n >= 800 && n < 1000
}
