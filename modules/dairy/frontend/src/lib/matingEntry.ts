// Belegung erfassen: dieselbe Nummer nicht zweimal melden. Innerhalb von 7 Tagen
// (vor oder nach dem Zeitraum der vorhandenen Belegung) gilt sie als schon gemeldet;
// so früh kommt kein Tier wieder in die Brunst.

export interface MatingSpan {
  animal_id: string
  service_date: string
  service_to: string | null
}

const DAY = 86_400_000
const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY

/** Jüngste Belegung des Tiers, die weniger als `days` Tage neben dem neuen Zeitraum liegt. */
export function recentMating<T extends MatingSpan>(matings: T[], animalId: string, from: string, to: string | null, days = 7): T | null {
  const start = dayOf(from)
  const end = dayOf(to || from)
  let hit: T | null = null
  for (const m of matings) {
    if (m.animal_id !== animalId) continue
    if (start - dayOf(m.service_to ?? m.service_date) > days || dayOf(m.service_date) - end > days) continue
    if (!hit || m.service_date > hit.service_date) hit = m
  }
  return hit
}
