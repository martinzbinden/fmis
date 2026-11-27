// Daten für die Mastauswertung (lib/fattening.ts): Lamm-Schlachtungen aus slaughter_records, dazu aus dem Mastplaner
// Einstallung, Wägungen, Gruppe und erfasste Kosten (v_animal_economics), und rein lesend aus den Milchschafen
// ("dairy_schafe" auf der gemeinsamen pglite-Datenbank, Muster lib/ownLambs.ts) Geburtsgewicht, Absetzen, Gewichte,
// Vater und Mutter. Verknüpft über animal_key; fehlt ein Modul auf diesem Gerät, fehlen nur seine Angaben.

import type { PGlite } from '@electric-sql/pglite'
import { getSharedDbRaw } from '@fmis/core/db'
import { animalKey, shortEarTag } from '@fmis/core/earTag'
import { loadAnimalInfo, loadSlaughterRecords } from './slaughterRecords'
import type { LambInput, LambSex, WeightPoint } from './fattening'

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))

interface LivestockAnimal {
  id: string
  birth_date: string | null
  sex: LambSex
  entry_date: string | null
  entry_weight_kg: number | null
  purchase_cost: number | null
  allocated_group_cost: number | null
  medication_cost: number | null
  group_name: string | null
  sire: string | null
  dam: string | null
  weights: WeightPoint[]
}

interface DairyLamb {
  birth_date: string | null
  sex: LambSex
  birth_weight_kg: number | null
  wean_date: string | null
  wean_reason: 'abgesetzt' | 'weggenommen' | null
  sire: string | null
  dam: string | null
  weights: WeightPoint[]
}

async function loadLivestock(pg: PGlite): Promise<Map<string, LivestockAnimal>> {
  const out = new Map<string, LivestockAnimal>()
  try {
    const [animals, weighings] = await Promise.all([
      pg.query<Record<string, unknown>>(`
        select a.id, a.ear_tag, a.birth_date, a.sex, a.entry_date, a.entry_weight_kg, a.purchase_cost,
               a.dam_ear_tag, a.sire_ear_tag, e.allocated_group_cost, e.medication_cost, g.name as group_name
        from animals a
        left join v_animal_economics e on e.animal_id = a.id
        left join lateral (
          select gm.group_id from group_memberships gm
          where gm.animal_id = a.id and gm.deleted_at is null
          order by gm.start_date desc limit 1
        ) cur on true
        left join animal_groups g on g.id = cur.group_id and g.deleted_at is null
        where a.deleted_at is null`),
      pg.query<{ animal_id: string; date: unknown; weight_kg: unknown }>('select animal_id, date, weight_kg from weighings where deleted_at is null'),
    ])
    const byId = new Map<string, LivestockAnimal>()
    for (const a of animals.rows) {
      const key = animalKey(a.ear_tag as string)
      if (!key) continue
      const sex = a.sex === 'm' || a.sex === 'w' || a.sex === 'k' ? a.sex : null
      const row: LivestockAnimal = {
        id: String(a.id),
        birth_date: iso(a.birth_date),
        sex,
        entry_date: iso(a.entry_date),
        entry_weight_kg: num(a.entry_weight_kg),
        purchase_cost: num(a.purchase_cost),
        allocated_group_cost: num(a.allocated_group_cost),
        medication_cost: num(a.medication_cost),
        group_name: (a.group_name as string | null) ?? null,
        sire: animalKey(a.sire_ear_tag as string | null),
        dam: animalKey(a.dam_ear_tag as string | null),
        weights: [],
      }
      out.set(key, row)
      byId.set(row.id, row)
    }
    for (const w of weighings.rows) {
      const a = byId.get(String(w.animal_id))
      const date = iso(w.date)
      const kg = num(w.weight_kg)
      if (a && date && kg != null) a.weights.push({ date, kg })
    }
  } catch {
    // ohne Mastplaner-Tiere
  }
  return out
}

const SCHEMA = 'dairy_schafe'

async function loadDairyLambs(): Promise<Map<string, DairyLamb>> {
  const out = new Map<string, DairyLamb>()
  let shared: PGlite
  try {
    shared = await getSharedDbRaw()
  } catch {
    return out
  }
  try {
    const [animals, offspring, weanings, weights] = await Promise.all([
      shared.query<{ id: string; ear_tag: string; birth_date: unknown; sex: string | null }>(`select id, ear_tag, birth_date, sex from "${SCHEMA}"."animals" where deleted_at is null`),
      shared.query<Record<string, unknown>>(
        `select o.id, o.animal_key, o.ear_tag, o.sex, o.birth_weight_kg, b.birth_date, b.sire_key, b.sire_ear_tag, b.sire_name, d.ear_tag as dam_tag
         from "${SCHEMA}"."birth_offspring" o
         join "${SCHEMA}"."births" b on b.id = o.birth_id and b.deleted_at is null
         left join "${SCHEMA}"."animals" d on d.id = b.dam_id
         where o.deleted_at is null`,
      ),
      shared.query<Record<string, unknown>>(`select offspring_id, animal_id, wean_date, reason from "${SCHEMA}"."weanings" where deleted_at is null order by wean_date`),
      shared.query<Record<string, unknown>>(`select offspring_id, animal_id, weigh_date, weight_kg from "${SCHEMA}"."animal_weights" where deleted_at is null`),
    ])
    const keyOfAnimal = new Map<string, string>()
    const keyOfOffspring = new Map<string, string>()
    const get = (key: string): DairyLamb => {
      let l = out.get(key)
      if (!l) {
        l = { birth_date: null, sex: null, birth_weight_kg: null, wean_date: null, wean_reason: null, sire: null, dam: null, weights: [] }
        out.set(key, l)
      }
      return l
    }
    for (const a of animals.rows) {
      const key = animalKey(a.ear_tag)
      if (!key) continue
      keyOfAnimal.set(String(a.id), key)
      const l = get(key)
      l.birth_date ??= iso(a.birth_date)
      l.sex ??= a.sex === 'm' || a.sex === 'w' ? a.sex : null
    }
    for (const o of offspring.rows) {
      const key = (o.animal_key as string | null) ?? animalKey(o.ear_tag as string | null)
      if (!key) continue
      keyOfOffspring.set(String(o.id), key)
      const l = get(key)
      l.birth_date ??= iso(o.birth_date)
      l.sex ??= o.sex === 'm' || o.sex === 'w' ? o.sex : null
      l.birth_weight_kg ??= num(o.birth_weight_kg)
      const sireKey = animalKey((o.sire_key as string | null) ?? (o.sire_ear_tag as string | null))
      const sireName = (o.sire_name as string | null)?.trim() || null
      l.sire ??= sireKey ? (sireName ? `${shortEarTag(sireKey)} ${sireName}` : shortEarTag(sireKey)) : sireName
      l.dam ??= animalKey(o.dam_tag as string | null)
    }
    const keyOf = (r: Record<string, unknown>) =>
      (r.animal_id ? keyOfAnimal.get(String(r.animal_id)) : undefined) ?? (r.offspring_id ? keyOfOffspring.get(String(r.offspring_id)) : undefined)
    // Absetzen: der jüngste Eintrag «abgesetzt» (oder ohne Grund); nur weggenommen zählt, wenn nichts anderes da ist
    for (const w of weanings.rows) {
      const key = keyOf(w)
      const date = iso(w.wean_date)
      if (!key || !date) continue
      const l = get(key)
      const reason = w.reason === 'weggenommen' ? 'weggenommen' : 'abgesetzt'
      if (reason === 'abgesetzt' || l.wean_reason !== 'abgesetzt') {
        l.wean_date = date
        l.wean_reason = reason
      }
    }
    for (const w of weights.rows) {
      const key = keyOf(w)
      const date = iso(w.weigh_date)
      const kg = num(w.weight_kg)
      if (key && date && kg != null) get(key).weights.push({ date, kg })
    }
  } catch {
    // Milchschafe auf diesem Gerät nicht vorhanden
  }
  return out
}

/** Alle Lamm-Schlachtungen mit den Angaben aus Mastplaner und Milchschafen. */
export async function loadFatteningInputs(pg: PGlite): Promise<LambInput[]> {
  const [records, info, livestock, dairy] = await Promise.all([loadSlaughterRecords(pg), loadAnimalInfo(pg), loadLivestock(pg), loadDairyLambs()])
  return records
    .filter((r) => r.category === 'Lamm')
    .map((r) => {
      const key = r.animal_key ?? animalKey(r.ear_tag)
      const a = key ? livestock.get(key) : undefined
      const d = key ? dairy.get(key) : undefined
      const i = key ? info.get(key) : undefined
      const sire = d?.sire ?? (a?.sire ? shortEarTag(a.sire) : null)
      return {
        id: r.id,
        ear_tag: r.ear_tag,
        animal_key: key,
        slaughter_date: r.slaughter_date,
        carcass_kg: r.carcass_kg,
        classification: r.classification,
        price_per_kg: r.price_per_kg,
        amount: r.amount,
        buyer: r.buyer,
        settlement_no: r.settlement_no,
        birth_date: a?.birth_date ?? i?.birth_date ?? d?.birth_date ?? null,
        sex: a?.sex ?? i?.sex ?? d?.sex ?? null,
        birth_weight_kg: d?.birth_weight_kg ?? null,
        weights: [...(a?.weights ?? []), ...(d?.weights ?? [])],
        livestock_id: a?.id ?? null,
        entry_date: a?.entry_date ?? null,
        entry_weight_kg: a?.entry_weight_kg ?? null,
        purchase_cost: a?.purchase_cost ?? null,
        allocated_group_cost: a?.allocated_group_cost ?? null,
        medication_cost: a?.medication_cost ?? null,
        group_name: a?.group_name ?? null,
        wean_date: d?.wean_date ?? null,
        wean_reason: d?.wean_reason ?? null,
        sire,
        dam: d?.dam ?? a?.dam ?? null,
      }
    })
}
