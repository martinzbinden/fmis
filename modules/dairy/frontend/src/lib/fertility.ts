// Fruchtbarkeitskennzahlen je Muttertier aus Geburten (births) und
// Belegungen (matings) — reine Funktionen, Grundlage für Tierdetail und
// Ausmerzliste.
//
// Begriffe: Zwischenkalbe-/Zwischenlammzeit (ZKZ/ZLZ) = Geburt bis nächste
// Geburt; Rastzeit = Geburt bis erste Belegung; Güstzeit = Geburt bis zur
// Belegung, aus der die nächste Trächtigkeit hervorging.

import { addDays, daysBetween } from './format'

export type Species = 'cattle' | 'sheep'

export const GESTATION_DAYS: Record<Species, number> = { cattle: 283, sheep: 150 }

export interface BirthEvent {
  birth_date: string
  parity: number | null
  conception_date: string | null
}

export interface MatingEvent {
  service_date: string
  service_to: string | null
  kind: 'kb' | 'natursprung' | null
  sire_key: string | null
  sire_name: string | null
}

export interface FertilityCycle {
  birth_date: string
  parity: number | null
  next_birth_date: string | null
  interval_days: number | null
  first_service_days: number | null
  open_days: number | null
  services: number
}

export interface FertilityStatus {
  cycles: FertilityCycle[]
  last_birth: string | null
  days_since_birth: number | null
  services_since_birth: number
  last_service: MatingEvent | null
  expected_birth: string | null
  mean_interval: number | null
  mean_first_service: number | null
  services_per_conception: number | null
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
}

export function computeFertility(
  births: BirthEvent[],
  matings: MatingEvent[],
  species: Species,
  today: string,
): FertilityStatus {
  const gestation = GESTATION_DAYS[species]
  const sortedBirths = [...new Map(births.map((b) => [b.birth_date, b])).values()].sort((a, b) =>
    a.birth_date.localeCompare(b.birth_date),
  )
  const sortedMatings = [...matings].sort((a, b) => a.service_date.localeCompare(b.service_date))

  const cycles: FertilityCycle[] = sortedBirths.map((birth, i) => {
    const next = sortedBirths[i + 1] ?? null
    // Belegungen, die zu DIESER Zwischengeburtsphase gehören: nach der Geburt
    // und spätestens so, dass daraus noch die nächste Geburt entstehen konnte
    // (Tragzeit minus 30 Tage Spielraum für Frühgeburten).
    const until = next ? addDays(next.birth_date, -(gestation - 30)) : today
    const services = sortedMatings.filter((m) => m.service_date > birth.birth_date && m.service_date <= until)
    const conception = next ? (next.conception_date ?? services.at(-1)?.service_date ?? null) : null
    return {
      birth_date: birth.birth_date,
      parity: birth.parity,
      next_birth_date: next?.birth_date ?? null,
      interval_days: next ? daysBetween(birth.birth_date, next.birth_date) : null,
      first_service_days: services.length ? daysBetween(birth.birth_date, services[0].service_date) : null,
      open_days: conception && conception > birth.birth_date ? daysBetween(birth.birth_date, conception) : null,
      services: services.length,
    }
  })

  const lastBirth = sortedBirths.at(-1)?.birth_date ?? null
  const servicesSinceBirth = sortedMatings.filter((m) => !lastBirth || m.service_date > lastBirth)
  const lastService = sortedMatings.at(-1) ?? null
  let expectedBirth: string | null = null
  if (lastService && (!lastBirth || lastService.service_date > lastBirth)) {
    expectedBirth = addDays(lastService.service_date, gestation)
  }

  const completed = cycles.filter((c) => c.next_birth_date)
  return {
    cycles,
    last_birth: lastBirth,
    days_since_birth: lastBirth ? daysBetween(lastBirth, today) : null,
    services_since_birth: servicesSinceBirth.length,
    last_service: lastService,
    expected_birth: expectedBirth,
    mean_interval: mean(completed.map((c) => c.interval_days!).filter((v) => v > 0)),
    mean_first_service: mean(cycles.map((c) => c.first_service_days).filter((v): v is number => v != null)),
    services_per_conception: mean(completed.filter((c) => c.services > 0).map((c) => c.services)),
  }
}
