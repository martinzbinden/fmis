import type { AnimalGroupPeriod } from './animals'

/** Gruppen-Zeiten eines Tiers (neueste zuerst) zusammenfassen: aufeinanderfolgende Zeiten
 * derselben Gruppe (z.B. nach einem Kategoriewechsel) gelten als eine. */
export function mergeAdjacentPeriods(periods: AnimalGroupPeriod[]): AnimalGroupPeriod[] {
  const out: AnimalGroupPeriod[] = []
  for (const p of periods) {
    const last = out[out.length - 1]
    if (last && last.groupId === p.groupId) out[out.length - 1] = { ...last, from: p.from < last.from ? p.from : last.from }
    else out.push(p)
  }
  return out
}

/** Die letzten `n` Gruppen eines Tiers (neueste zuerst), für die Tierseite:
 * die aktuelle und die davor, mit «bis»-Datum (`to`). */
export function lastGroups(history: AnimalGroupPeriod[], n = 2): AnimalGroupPeriod[] {
  return mergeAdjacentPeriods(history).slice(0, n)
}
