import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { allesWieGestern, abstandM, inDerNaehe, koennteFaellig, laufhofGestern, wieGestern } from './tageskarte'
import { laufhofSetzen } from './laufhof'
import { rueckgaengig } from './schnell'
import { wgs84ToLv95, lv95ToWgs84 } from './lv95'
import type { Parcel } from '../types'

// Quadrat 100 × 100 m im Grossen Moos (erfundener Demohof, LV95)
const E = 2580700
const N = 1203500
const quadrat = (dx: number, dy: number) => {
  const ring = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]].map(([x, y]) => lv95ToWgs84([E + dx + x, N + dy + y]))
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] })
}

async function setup() {
  const s = await memoryDb()
  s.put('parcels', { id: 'a', season_year: 2026, name: 'Hausmatte', category: 'futter', sort_order: 1, base_geometry: quadrat(0, 0) })
  s.put('parcels', { id: 'b', season_year: 2026, name: 'Rain', category: 'futter', sort_order: 2, base_geometry: quadrat(250, 0) })
  s.put('parcels', { id: 'c', season_year: 2026, name: 'Acker', category: 'acker', sort_order: 3, base_geometry: quadrat(2000, 0) })
  const parcels = s.rows('parcels') as Parcel[]
  const weide = (pid: string, d: string, cat = 'kuehe', n: number | null = 20) =>
    s.put('usage_entries', { id: crypto.randomUUID(), parcel_id: pid, entry_date: d, usage_type: 'weide', animal_category: cat as 'kuehe', animal_count: n })
  return { s, parcels, weide }
}

describe('Tageskarte', () => {
  it('wie gestern: fehlende Nutzungen von gestern, nicht doppelt', async () => {
    const { s, parcels, weide } = await setup()
    weide('a', '2026-05-09', 'rinder', 12)
    s.put('usage_entries', { id: 'e1', parcel_id: 'b', entry_date: '2026-05-09', usage_type: 'eingrasen' })
    weide('a', '2026-05-10', 'rinder', 12)
    const v = wieGestern(s, '2026-05-10', parcels)
    expect(v.map((x) => `${x.parcel.name}:${x.text}`)).toEqual(['Rain:Eingrasen'])
    expect(wieGestern(s, '2026-05-11', parcels)[0]).toMatchObject({ text: 'Weide Rinder · 12', tiere: { animal_category: 'rinder', animal_count: 12 } })
  })

  it('Alles wie gestern: Nutzungen und Laufhof, Rückgängig', async () => {
    const { s, parcels, weide } = await setup()
    weide('a', '2026-05-09')
    weide('b', '2026-05-09', 'rinder', 8)
    laufhofSetzen(s, '2026-05-09', 'kaelber', 'L')
    expect(laufhofGestern(s, '2026-05-10', ['kuehe', 'kaelber'])).toEqual([{ kategorie: 'kaelber', wert: 'L' }])
    const r = allesWieGestern(s, '2026-05-10', parcels, ['kuehe', 'rinder', 'kaelber'])
    expect(r.erfasst).toHaveLength(2)
    const heute = s.rows('usage_entries').filter((u) => u.entry_date === '2026-05-10')
    expect(heute.map((u) => `${u.parcel_id}:${u.animal_category}:${u.animal_count}`).sort()).toEqual(['a:kuehe:20', 'b:rinder:8'])
    expect(s.rows('daily_farm_log').find((l) => l.entry_date === '2026-05-10')?.laufhof_kaelber).toBe('L')
    expect(wieGestern(s, '2026-05-10', parcels)).toHaveLength(0)
    rueckgaengig(s, r.erfasst)
    expect(s.rows('usage_entries').filter((u) => u.entry_date === '2026-05-10')).toHaveLength(0)
  })

  it('könnte fällig: Weide nach Ruhezeit, Schnitt nach Aufwuchs, nur Futterflächen in der Saison', async () => {
    const { s, parcels, weide } = await setup()
    weide('a', '2026-05-01')
    s.put('usage_entries', { id: 's1', parcel_id: 'b', entry_date: '2026-04-20', usage_type: 'silage' })
    s.put('usage_entries', { id: 's2', parcel_id: 'c', entry_date: '2026-04-01', usage_type: 'silage' })
    expect(koennteFaellig(s, '2026-05-15', parcels)).toEqual([])
    const v = koennteFaellig(s, '2026-05-25', parcels)
    expect(v.map((x) => `${x.parcel.name}:${x.art}:${x.tageSeit}`)).toEqual(['Rain:schnitt:35', 'Hausmatte:weide:24'])
    expect(v[1].tiere).toMatchObject({ animal_category: 'kuehe' })
    expect(koennteFaellig(s, '2026-12-01', parcels)).toEqual([])
  })

  it('in der Nähe: drin = 0 m, Abstand zum Rand, Umkreis', async () => {
    const { parcels } = await setup()
    const [lng, lat] = lv95ToWgs84([E + 50, N + 50])
    const n = inDerNaehe(parcels, lat, lng)
    expect(n.map((x) => `${x.parcel.name}:${x.m}`)).toEqual(['Hausmatte:0', 'Rain:200'])
    const [x, y] = wgs84ToLv95([lng, lat])
    expect(Math.round(abstandM(x + 100, y, [[[[E, N], [E + 100, N], [E + 100, N + 100], [E, N + 100], [E, N]]]]))).toBe(50)
  })
})
