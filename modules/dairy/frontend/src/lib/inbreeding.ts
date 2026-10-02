// Verwandtschaft und Inzucht aus dem Stammbaum (pedigree), rekursiv nach
// Malécot mit Memo — bei einigen hundert Individuen unkritisch.
//
// f(a, b) = Verwandtschaftskoeffizient (Wahrscheinlichkeit, dass zwei
// zufällig gezogene Allele herkunftsgleich sind). Inzuchtkoeffizient eines
// Tiers F(x) = f(Vater, Mutter); erwartete Inzucht eines Nachkommen aus
// einer Anpaarung = f(Mutter, Vater).
//
// Aussagekraft: unbekannte Vorfahren gelten als unverwandt. Bei flachem
// Stammbaum (Schafe ⌀ 1.5 vollständige Generationen) wird F darum
// unterschätzt — completeness() liefert dazu die äquivalenten vollständigen
// Generationen.

export interface PedigreeLink {
  sire: string | null
  dam: string | null
}

export class Inbreeding {
  private readonly depthMemo = new Map<string, number>()
  private readonly kinMemo = new Map<string, number>()
  private readonly ecgMemo = new Map<string, number>()

  constructor(private readonly pedigree: Map<string, PedigreeLink>) {}

  private parents(x: string): PedigreeLink {
    return this.pedigree.get(x) ?? { sire: null, dam: null }
  }

  /** Generationstiefe (Gründer = 0). Ein fehlerhafter Stammbaum mit Zyklus
   * (Tier als eigener Vorfahre) bricht ab und zählt dort als Gründer. */
  private depth(x: string, visiting = new Set<string>()): number {
    const memo = this.depthMemo.get(x)
    if (memo !== undefined) return memo
    if (visiting.has(x)) return 0
    visiting.add(x)
    const { sire, dam } = this.parents(x)
    const d = Math.max(sire ? this.depth(sire, visiting) + 1 : 0, dam ? this.depth(dam, visiting) + 1 : 0)
    visiting.delete(x)
    this.depthMemo.set(x, d)
    return d
  }

  /** Verwandtschaftskoeffizient f(a, b). */
  kinship(a: string | null, b: string | null): number {
    if (!a || !b) return 0
    if (a === b) return (1 + this.inbreeding(a)) / 2
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const memo = this.kinMemo.get(key)
    if (memo !== undefined) return memo
    // Das Tier mit der grösseren Tiefe kann kein Vorfahre des anderen sein —
    // dessen Eltern auflösen.
    const [younger, other] = this.depth(a) >= this.depth(b) ? [a, b] : [b, a]
    const { sire, dam } = this.parents(younger)
    // Vorläufig 0 eintragen: schützt bei einem fehlerhaften Zyklus vor
    // endloser Rekursion.
    this.kinMemo.set(key, 0)
    const f = (this.kinship(sire, other) + this.kinship(dam, other)) / 2
    this.kinMemo.set(key, f)
    return f
  }

  /** Inzuchtkoeffizient F eines Tiers. */
  inbreeding(x: string): number {
    const { sire, dam } = this.parents(x)
    return this.kinship(sire, dam)
  }

  /** Erwartete Inzucht des Nachkommen aus Mutter × Vater. */
  offspring(dam: string | null, sire: string | null): number {
    return this.kinship(dam, sire)
  }

  /** Äquivalente vollständige Generationen: Summe über alle bekannten
   * Vorfahren von (1/2)^Generation — beide Eltern bekannt = 1, dazu alle
   * vier Grosseltern = 2. */
  completeness(x: string, visiting = new Set<string>()): number {
    const memo = this.ecgMemo.get(x)
    if (memo !== undefined) return memo
    if (visiting.has(x)) return 0
    visiting.add(x)
    const { sire, dam } = this.parents(x)
    const part = (p: string | null) => (p ? 0.5 * (1 + this.completeness(p, visiting)) : 0)
    const v = part(sire) + part(dam)
    visiting.delete(x)
    this.ecgMemo.set(x, v)
    return v
  }
}

/** Einstufung für die Farbe: ab 6.25 % (Halbgeschwister-Paarung ist 12.5 %,
 * Cousins 6.25 %) Warnung, ab 3.125 % Hinweis. */
export function inbreedingClass(f: number): 'none' | 'low' | 'medium' | 'high' {
  if (f >= 0.0625) return 'high'
  if (f >= 0.03125) return 'medium'
  if (f > 0) return 'low'
  return 'none'
}

export function fmtInbreeding(f: number): string {
  return `${(f * 100).toLocaleString('de-CH', { maximumFractionDigits: 1, minimumFractionDigits: f > 0 && f < 0.1 ? 1 : 0 })} %`
}
