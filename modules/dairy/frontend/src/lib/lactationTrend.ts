// Tendenz über die Laktationen (Punkt 4 der Laktationsauswertung): bleibt
// die Leistung über die Laktationen stabil, oder nimmt sie ab? Grundlage ist
// das Niveau je Laktation aus lib/lactationCurves.ts — im Testtag-Vergleich
// mit den Herdengenossinnen, also ohne Jahres- und Saisoneffekte. Damit sind
// Laktationen verschiedener Jahre direkt vergleichbar.
//
// - Steigung: Regression des Niveaus über die letzten bis 3 Laktationen
//   (Prozentpunkte je Laktation). Die laufende zählt mit, sobald sie 3
//   gezählte Wägungen hat — vorher ist sie zu unsicher.
// - Rückgänge in Folge: wie oft das Niveau von Laktation zu Laktation um
//   mindestens 5 Punkte gefallen ist, bis zur neuesten.
// - Laufende Laktation: im Vergleich zum eigenen Mittel der früheren.
// Reine Funktionen (getestet).

import { slope, type LactationCurve } from './lactationCurves'

/** Unterschied, ab dem eine Veränderung zählt (5 Prozentpunkte). */
export const TREND_STEP = 0.05
const TREND_SPAN = 3
const MIN_RUNNING_TESTS = 3

export interface LactationLevel {
  lactation_number: number
  level: number
  running: boolean
  /** gezählte Wägungen */
  tests: number
}

export type TrendDirection = 'steigend' | 'stabil' | 'fallend'

export interface LactationTrend {
  /** aufsteigend nach Laktationsnummer, nur bewertete */
  levels: LactationLevel[]
  /** Änderung je Laktation (0.1 = +10 Prozentpunkte); ab 2 Laktationen */
  slope: number | null
  direction: TrendDirection | null
  /** Rückgänge ≥ 5 Punkte in Folge bis zur neuesten bewerteten Laktation */
  fallingStreak: number
  /** laufende Laktation gegen das Mittel der eigenen früheren */
  running: { level: number; ownMean: number | null; tests: number } | null
}

export function lactationTrend(levels: LactationLevel[]): LactationTrend {
  const sorted = [...levels].sort((a, b) => a.lactation_number - b.lactation_number)
  const usable = sorted.filter((l) => !l.running || l.tests >= MIN_RUNNING_TESTS)
  const recent = usable.slice(-TREND_SPAN)
  const s = recent.length >= 2 ? slope(recent.map((l) => l.lactation_number), recent.map((l) => l.level)) : null
  const direction: TrendDirection | null = s == null ? null : s >= TREND_STEP ? 'steigend' : s <= -TREND_STEP ? 'fallend' : 'stabil'

  let fallingStreak = 0
  for (let i = usable.length - 1; i > 0; i--) {
    if (usable[i].level <= usable[i - 1].level - TREND_STEP) fallingStreak++
    else break
  }

  const run = sorted.find((l) => l.running) ?? null
  const earlier = sorted.filter((l) => !l.running)
  return {
    levels: sorted,
    slope: s,
    direction,
    fallingStreak,
    running: run
      ? { level: run.level, ownMean: earlier.length ? earlier.reduce((sum, l) => sum + l.level, 0) / earlier.length : null, tests: run.tests }
      : null,
  }
}

/** Trend je Tier aus den analysierten Kurven. `isRunning` sagt, ob eine
 * Laktation noch läuft (aus den Abschlussarten der Laktationsdaten). */
export function trendsByAnimal(curves: Iterable<LactationCurve>, isRunning: (animalId: string, lactationNumber: number) => boolean): Map<string, LactationTrend> {
  const levels = new Map<string, LactationLevel[]>()
  for (const c of curves) {
    if (c.level == null) continue
    const list = levels.get(c.animal_id) ?? []
    list.push({
      lactation_number: c.lactation_number,
      level: c.level,
      running: isRunning(c.animal_id, c.lactation_number),
      tests: c.points.filter((p) => !p.excluded).length,
    })
    levels.set(c.animal_id, list)
  }
  return new Map([...levels].map(([id, list]) => [id, lactationTrend(list)]))
}

export const TREND_ARROW: Record<TrendDirection, string> = { steigend: '↗', stabil: '→', fallend: '↘' }

/** "112 → 98 → 84 %" — die letzten Niveaus, laufende mit "(lfd.)". */
export function levelSeries(t: LactationTrend, last = 4): string {
  return t.levels
    .slice(-last)
    .map((l) => `${Math.round(l.level * 100)}${l.running ? ' (lfd.)' : ''}`)
    .join(' → ') + ' %'
}
