import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { aufenthaltAm, aufenthalte, herdeAnlegen, herdenStand, herdenZuruecksetzen, nichtHier, nutzungen, ortText, stallAuslauf, umziehen, weideAusHerden } from './herden'

async function setup() {
  const s = await memoryDb()
  s.put('parcels', { id: 'a', season_year: 2026, name: 'Hausmatte' })
  s.put('parcels', { id: 'b', season_year: 2026, name: 'Rain' })
  const h = herdeAnlegen(s, { name: 'Milchkühe', kategorie: 'kuehe', anzahl: 22 }, { ort: 'weide', parcel_id: 'a' }, '2026-05-01')
  return { s, h }
}
const tage = (s: Awaited<ReturnType<typeof setup>>['s'], von: string, bis: string, heute = '2026-05-31') =>
  weideAusHerden(s, von, bis, heute).map((u) => `${u.entry_date.slice(8)}${u.parcel_id}`)

describe('Herden', () => {
  it('offener Aufenthalt: Weide jeden Tag bis heute, nicht in die Zukunft', async () => {
    const { s } = await setup()
    expect(tage(s, '2026-04-29', '2026-05-03', '2026-05-02')).toEqual(['01a', '02a'])
    const u = weideAusHerden(s, '2026-05-01', '2026-05-01', '2026-05-01')[0]
    expect(u).toMatchObject({ usage_type: 'weide', animal_category: 'kuehe', animal_count: 22, animal_group: 'Milchkühe', parcel_id: 'a' })
  })

  it('Umziehen: alter Aufenthalt endet gestern (oder heute mit «auf beiden»)', async () => {
    const { s, h } = await setup()
    umziehen(s, [h], { ort: 'weide', parcel_id: 'b' }, '2026-05-04')
    expect(tage(s, '2026-05-02', '2026-05-05')).toEqual(['02a', '03a', '04b', '05b'])
    umziehen(s, [h], { ort: 'weide', parcel_id: 'a' }, '2026-05-06', true)
    expect(tage(s, '2026-05-05', '2026-05-07').sort()).toEqual(['05b', '06a', '06b', '07a'])
    expect(ortText(s, aufenthaltAm(s, h, '2026-05-09'), '2026-05-09')).toBe('Hausmatte · seit 6.5. (4. Tag)')
  })

  it('Umzug am Starttag ersetzt den Aufenthalt; Nachtrag endet vor dem späteren', async () => {
    const { s, h } = await setup()
    umziehen(s, [h], { ort: 'weide', parcel_id: 'b' }, '2026-05-01')
    expect(aufenthalte(s, h)).toHaveLength(1)
    umziehen(s, [h], { ort: 'weide', parcel_id: 'a' }, '2026-05-10')
    umziehen(s, [h], { ort: 'stall', auslauf: 'L' }, '2026-05-05') // Nachtrag
    expect(aufenthalte(s, h).map((a) => `${a.ort}:${a.von.slice(8)}-${a.bis?.slice(8) ?? ''}`)).toEqual(['weide:01-04', 'stall:05-09', 'weide:10-'])
  })

  it('Einstallen: Laufhof auto L, ohne Auslauf 0; keine Weide', async () => {
    const { s, h } = await setup()
    umziehen(s, [h], { ort: 'stall', auslauf: 'L' }, '2026-05-03')
    umziehen(s, [h], { ort: 'stall', auslauf: '0' }, '2026-05-05')
    const m = stallAuslauf(s, '2026-05-01', '2026-05-06', '2026-05-06')
    expect([...m].map(([d, t]) => `${d.slice(8)}${t.get('kuehe')}`)).toEqual(['03L', '04L', '050', '060'])
    expect(tage(s, '2026-05-01', '2026-05-06', '2026-05-06')).toEqual(['01a', '02a'])
  })

  it('Einzelne Tage «nicht hier» teilen den Aufenthalt; von Hand erfasste Weide geht vor', async () => {
    const { s, h } = await setup()
    const a = aufenthaltAm(s, h, '2026-05-03')!
    nichtHier(s, a.id, '2026-05-04', '2026-05-03')
    expect(tage(s, '2026-05-01', '2026-05-06', '2026-05-06')).toEqual(['01a', '02a', '05a', '06a'])
    nichtHier(s, aufenthaltAm(s, h, '2026-05-01')!.id, '2026-05-01', '2026-05-01')
    expect(tage(s, '2026-05-01', '2026-05-06', '2026-05-06')).toEqual(['02a', '05a', '06a'])
    s.put('usage_entries', { id: 'm', parcel_id: 'a', entry_date: '2026-05-05', usage_type: 'weide', animal_category: 'kuehe', animal_count: 10 })
    const n = nutzungen(s, '2026-05-05', '2026-05-05').filter((u) => u.parcel_id === 'a')
    expect(n).toHaveLength(1)
    expect(n[0].id).toBe('m')
  })

  it('Rückgängig: Umzug und Teilung auf den Stand davor', async () => {
    const { s, h } = await setup()
    const vorher = tage(s, '2026-05-01', '2026-05-08', '2026-05-08')
    const stand = herdenStand(s, [h])
    umziehen(s, [h], { ort: 'weide', parcel_id: 'b' }, '2026-05-04')
    nichtHier(s, aufenthaltAm(s, h, '2026-05-06')!.id, '2026-05-06', '2026-05-06')
    herdenZuruecksetzen(s, [h], stand)
    expect(tage(s, '2026-05-01', '2026-05-08', '2026-05-08')).toEqual(vorher)
  })
})
