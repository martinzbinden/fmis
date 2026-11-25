// Gewicht je Tier für den Platzbedarf beim Transport (lib/transportSpace.ts).
// Rindvieh: wie der Schlachtwert (Waage, Messband, Auge, sonst Alter + Rasse; lib/carcassValue.ts).
// Schafe: letzte Wägung (Jungtiere höchstens 45 Tage alt, ausgewachsene 1 Jahr), sonst Lämmer nach Alter, ausgewachsene
// Schafe als «über 60 kg» angenommen. Widder über 1 Jahr zählen als Zuchtwidder.

import type { PGlite } from '@electric-sql/pglite'
import { loadCattleData } from './carcassData'
import { cattleValue, type PriceTable } from './carcassValue'
import { isoDate } from './format'
import { ageOnDate } from './meatValue'
import { lambKgByAge, SHEEP_ADULT_DAYS, SHEEP_ADULT_KG, WEIGHT_VALID_DAYS, type TransportAnimal, type TransportSpecies } from './transportSpace'

export async function loadTransportAnimals(pg: PGlite, species: TransportSpecies, today: string, prices: PriceTable): Promise<Map<string, TransportAnimal>> {
  const out = new Map<string, TransportAnimal>()
  if (species === 'cattle') {
    const data = await loadCattleData(pg, prices)
    for (const [id, input] of data.inputs) {
      const v = cattleValue(input, today, prices, undefined, data.calibration)
      const scale = input.weights.some((w) => w.method === 'waage' && w.date <= today && today <= addDays(w.date, WEIGHT_VALID_DAYS.young))
      out.set(id, { id, species, liveKg: v?.liveKg ?? null, basis: v?.liveKg == null ? 'annahme' : scale ? 'waage' : 'schaetzung' })
    }
    return out
  }
  const [animals, weights] = await Promise.all([
    pg.query<{ id: string; birth_date: unknown; sex: string | null }>("select id, birth_date, sex from animals where deleted_at is null and status = 'aktiv'").then((r) => r.rows),
    pg.query<{ animal_id: string; weigh_date: unknown; weight_kg: unknown }>('select animal_id, weigh_date, weight_kg from animal_weights where deleted_at is null and animal_id is not null and weigh_date <= $1', [today]).then((r) => r.rows),
  ])
  const last = new Map<string, { date: string; kg: number }>()
  for (const w of weights) {
    const date = isoDate(w.weigh_date)
    if (!date) continue
    const prev = last.get(w.animal_id)
    if (!prev || prev.date < date) last.set(w.animal_id, { date, kg: Number(w.weight_kg) })
  }
  for (const a of animals) {
    const birth = isoDate(a.birth_date)
    const age = birth ? ageOnDate(birth, today) : null
    const adult = age == null || age >= SHEEP_ADULT_DAYS
    const w = last.get(a.id)
    const fresh = w && ageOnDate(w.date, today) <= (adult ? WEIGHT_VALID_DAYS.adult : WEIGHT_VALID_DAYS.young)
    const breedingRam = a.sex === 'm' && adult
    if (fresh) out.set(a.id, { id: a.id, species, liveKg: w.kg, basis: 'waage', breedingRam })
    else if (adult) out.set(a.id, { id: a.id, species, liveKg: SHEEP_ADULT_KG, basis: 'annahme', breedingRam })
    else out.set(a.id, { id: a.id, species, liveKg: lambKgByAge(age), basis: 'schaetzung', breedingRam })
  }
  return out
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
