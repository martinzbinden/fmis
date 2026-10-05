// Joghurt-Planer: für eine gewünschte Milchmenge die geeignetsten Kühe
// vorschlagen und die Gehalte der Mischmilch rechnen — reine Funktionen
// (getestet). Gehalte sind mengengewichtet (Σ kg × % / Σ kg), die Zellzahl
// ebenso (wie die Tankmilch-Zellzahl).

export interface YogurtCow {
  animal_id: string
  label: string
  /** Wägung, aus der die Milchmenge stammt */
  test_date: string
  /** Tagesmilch kg (Wägung) */
  milk_kg: number
  fat_pct: number | null
  protein_pct: number | null
  /** Zellzahl in 1000/ml (wie in milk_tests gespeichert) */
  cell_count: number | null
  /** Gehalte aus einer früheren Wägung (letzte ohne Laboranalyse) */
  analysis_date: string | null
  dry: boolean
  /** letzter Tag einer offenen Milch-Absetzfrist */
  withdrawal_until: string | null
}

export type YogurtCriterion = 'eiweiss' | 'fett_eiweiss' | 'zellzahl'

export const CRITERION_LABEL: Record<YogurtCriterion, string> = {
  eiweiss: 'höchstes Eiweiss',
  fett_eiweiss: 'höchstes Fett + Eiweiss',
  zellzahl: 'tiefste Zellzahl',
}

export interface YogurtOptions {
  /** gewünschte Milchmenge kg */
  targetKg: number
  /** 1 = Tagesmilch (beide Gemelke), 0.5 = ein Gemelk */
  factor: number
  criterion: YogurtCriterion
  /** Kühe darüber nicht vorschlagen (1000/ml), null = egal */
  maxCellCount: number | null
}

/** Warum eine Kuh nicht vorgeschlagen wird (null = geeignet). Gesperrt
 * (nicht wählbar) sind trockene und solche mit offener Absetzfrist. */
export function exclusion(c: YogurtCow, opts: Pick<YogurtOptions, 'maxCellCount' | 'criterion'>, today: string): { reason: string; blocked: boolean } | null {
  if (c.withdrawal_until && c.withdrawal_until >= today) return { reason: `Absetzfrist bis ${c.withdrawal_until}`, blocked: true }
  if (c.dry) return { reason: 'trocken', blocked: true }
  if (c.milk_kg <= 0) return { reason: 'keine Milch', blocked: true }
  if (c.protein_pct == null || (opts.criterion === 'fett_eiweiss' && c.fat_pct == null)) return { reason: 'ohne Laboranalyse', blocked: false }
  if (opts.maxCellCount != null && c.cell_count != null && c.cell_count > opts.maxCellCount) return { reason: 'Zellzahl zu hoch', blocked: false }
  if (opts.criterion === 'zellzahl' && c.cell_count == null) return { reason: 'ohne Zellzahl', blocked: false }
  return null
}

const score = (c: YogurtCow, criterion: YogurtCriterion) =>
  criterion === 'eiweiss' ? (c.protein_pct ?? 0) : criterion === 'fett_eiweiss' ? (c.protein_pct ?? 0) + (c.fat_pct ?? 0) : -(c.cell_count ?? Infinity)

/** Vorschlag: geeignete Kühe nach dem Kriterium, bis die Menge erreicht ist
 * (die letzte darf überschiessen). So ist der gewichtete Gehalt für die
 * Menge bestmöglich. */
export function suggestYogurt(cows: YogurtCow[], opts: YogurtOptions, today: string): string[] {
  const ok = cows.filter((c) => !exclusion(c, opts, today)).sort((a, b) => score(b, opts.criterion) - score(a, opts.criterion))
  const picked: string[] = []
  let kg = 0
  for (const c of ok) {
    if (kg >= opts.targetKg) break
    picked.push(c.animal_id)
    kg += c.milk_kg * opts.factor
  }
  return picked
}

export interface YogurtMix {
  n: number
  milkKg: number
  fatPct: number | null
  proteinPct: number | null
  /** 1000/ml, mengengewichtet */
  cellCount: number | null
  /** Milch ohne bekannte Gehalte (in den Prozenten nicht enthalten) */
  unknownKg: number
}

export function yogurtMix(cows: YogurtCow[], factor: number): YogurtMix {
  let milk = 0
  let fatKg = 0
  let fatBase = 0
  let protKg = 0
  let protBase = 0
  let cells = 0
  let cellBase = 0
  let unknown = 0
  for (const c of cows) {
    const kg = c.milk_kg * factor
    milk += kg
    if (c.fat_pct != null) {
      fatKg += (kg * c.fat_pct) / 100
      fatBase += kg
    }
    if (c.protein_pct != null) {
      protKg += (kg * c.protein_pct) / 100
      protBase += kg
    } else unknown += kg
    if (c.cell_count != null) {
      cells += kg * c.cell_count
      cellBase += kg
    }
  }
  return {
    n: cows.length,
    milkKg: milk,
    fatPct: fatBase ? (fatKg / fatBase) * 100 : null,
    proteinPct: protBase ? (protKg / protBase) * 100 : null,
    cellCount: cellBase ? cells / cellBase : null,
    unknownKg: unknown,
  }
}
