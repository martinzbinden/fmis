import type { AnimalMilkCurrent } from '../types'

export const TARGET_PROTEIN_PCT = 3.7

export interface YogurtSelectionResult {
  selected: AnimalMilkCurrent[]
  totalMilkKg: number
  weightedProteinPct: number
}

/**
 * Wählt eine Teilmenge der Kühe für dicke Joghurtmilch: Kühe nach %Eiweiss
 * absteigend sortieren, nacheinander hinzufügen und den laufenden
 * MENGENGEWICHTETEN Eiweiss-Schnitt nachführen, stoppen sobald die nächste
 * (schwächere) Kuh den Schnitt unter targetPct drücken würde. Bewusst eine
 * einfache Heuristik (maximiert nicht global die Milchmenge), aber
 * garantiert einen möglichst grossen Anteil bei absteigender Abarbeitung.
 */
export function selectYogurtCows(
  cows: AnimalMilkCurrent[],
  targetPct: number = TARGET_PROTEIN_PCT,
): YogurtSelectionResult {
  const sorted = [...cows].sort((a, b) => b.protein_pct - a.protein_pct)

  let totalMilkKg = 0
  let totalProteinKg = 0
  const selected: AnimalMilkCurrent[] = []

  for (const cow of sorted) {
    const nextMilkKg = totalMilkKg + cow.milk_kg
    const nextProteinKg = totalProteinKg + cow.protein_kg
    const nextAvgPct = (nextProteinKg / nextMilkKg) * 100
    if (nextAvgPct < targetPct) break
    selected.push(cow)
    totalMilkKg = nextMilkKg
    totalProteinKg = nextProteinKg
  }

  return {
    selected,
    totalMilkKg,
    weightedProteinPct: totalMilkKg > 0 ? (totalProteinKg / totalMilkKg) * 100 : 0,
  }
}
