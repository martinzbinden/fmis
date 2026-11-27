// Saison der klassischen Seiten: reine Hilfen (Hook: hooks/useSeasonYear.ts).

export const CURRENT_YEAR = new Date().getFullYear()

export function parseSeasonYear(v: string | null): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 2000 && n < 2100 ? n : null
}

/** Jahre zur Wahl: Saisons mit Parzellen, das laufende und das nächste (Planung) sowie das gewählte, absteigend. */
export function seasonYearOptions(dataYears: (number | null | undefined)[], current: number, selected: number): number[] {
  const s = new Set<number>([current, current + 1, selected])
  for (const y of dataYears) if (typeof y === 'number' && y > 2000 && y < 2100) s.add(y)
  return [...s].sort((a, b) => b - a)
}
