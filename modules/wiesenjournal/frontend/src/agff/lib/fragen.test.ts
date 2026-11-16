import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { saveFertilizationEntry } from './fertilization'
import { beantworten, geschnitten, letzteDuengung } from './fragen'
import type { Parcel } from '../types'
import { REGEN_KEY } from './regen'

const HEUTE = '2026-06-16'

async function setup() {
  const s = await memoryDb()
  const p = (id: string, name: string, area_a: number, category = 'futter') => s.put('parcels', { id, season_year: 2026, name, area_a, category: category as Parcel['category'] })
  const a = p('a', 'Rain', 200)
  const b = p('b', 'Moos', 100)
  p('c', 'Bach', 50)
  p('d', 'Acher', 300, 'acker')
  const t = s.rows('fertilizer_types').find((x) => x.unit === 'm3')!
  const gabe = (anchor: Parcel, extra: Parcel[], d: string, amount: number) =>
    saveFertilizationEntry(s, {
      id: null, anchorParcel: anchor, entry_date: d, season_year: 2026, type: t, amount, container_count: null, container_size: null,
      dilution: null, gabe_number: null, notes: null, extent_type: extra.length ? 'parcels' : 'parcel', extra_parcels: extra, geometry: null,
    })
  gabe(a, [b], '2026-05-01', 60) // 60 m³ auf 3 ha
  gabe(a, [], '2026-06-10', 40)
  s.put('usage_entries', { id: 's1', parcel_id: 'a', entry_date: '2026-05-20', usage_type: 'silage', yield_amount: null })
  s.put('usage_entries', { id: 'w1', parcel_id: 'c', entry_date: '2026-06-01', usage_type: 'weide', animal_category: 'kuehe' })
  s.put('usage_entries', { id: 'w2', parcel_id: 'c', entry_date: '2026-06-02', usage_type: 'weide', animal_category: 'kuehe' })
  return { s, t }
}

describe('Suchen und Fragen (Etappe 6)', () => {
  it('Letzte Düngung: älteste zuerst, nie gedüngte ganz oben, auch über Anteile', async () => {
    const { s } = await setup()
    expect(letzteDuengung(s, HEUTE).get('b')?.datum).toBe('2026-05-01')
    const a = beantworten(s, 'duengung', 2026, { heute: HEUTE })
    expect(a.zeilen.map((z) => z.parcel?.name)).toEqual(['Acher', 'Bach', 'Moos', 'Rain'])
    expect(a.zeilen.find((z) => z.parcel?.id === 'b')).toMatchObject({ alter: 46 })
  })
  it('Güllegaben seit Datum mit m³/ha; noch nicht geschnitten; Weidetage; fehlender Ertrag', async () => {
    const { s } = await setup()
    const g = beantworten(s, 'guelle', 2026, { seit: '2026-05-01', heute: HEUTE })
    expect(g.zeilen).toHaveLength(2)
    expect(g.zeilen[1].werte).toEqual(['1.5.2026', 'Rain, Moos', expect.any(String), 60, 20])
    expect(beantworten(s, 'guelle', 2026, { seit: '2026-06-01', heute: HEUTE }).zeilen).toHaveLength(1)
    expect([...geschnitten(s, 2026, HEUTE)]).toEqual(['a'])
    expect(beantworten(s, 'ungeschnitten', 2026, { heute: HEUTE }).zeilen.map((z) => z.parcel?.name)).toEqual(['Moos', 'Bach'])
    expect(beantworten(s, 'weidetage', 2026, { heute: HEUTE }).zeilen[0].werte).toEqual(['Bach', 2, '2.6.2026'])
    expect(beantworten(s, 'ertrag', 2026, { heute: HEUTE }).zeilen[0].werte).toEqual(['20.5.2026', 'Rain', 'Silage'])
  })
  it('Regen: Spalten bei Gülle und letzter Düngung, Frage «Wie viel hat es geregnet seit …?»', async () => {
    const { s } = await setup()
    // ohne Regenwerte keine Regen-Spalten
    expect(beantworten(s, 'guelle', 2026, { heute: HEUTE }).spalten).toHaveLength(5)
    expect(beantworten(s, 'regen', 2026, { seit: '2026-06-01', heute: HEUTE }).zeilen).toHaveLength(0)
    // 1.–14.6. in Zehntel-mm: 3.6. 5 mm, 10.6. 1.2, 11.6. 3, 13.6. 0.5; 15. und 16. noch nicht da
    const mm10 = [0, 0, 50, 0, 0, 0, 0, 0, 0, 12, 30, 0, 5, 0]
    s.setSetting(REGEN_KEY, { 2026: { fehlt: false, gitter: null, zelle: '1_1', start: '2026-06-01', mm10, geholt: '2026-06-16T06:00:00Z' } })
    const g = beantworten(s, 'guelle', 2026, { seit: '2026-05-01', heute: HEUTE })
    expect(g.spalten.slice(5)).toEqual(['Regen mm am Tag', 'Regen 3 Tage danach'])
    expect(g.zeilen[0].werte.slice(5)).toEqual([1.2, '3.5 mm']) // 10.6.: 11.–13.6.
    expect(g.zeilen[1].werte.slice(5)).toEqual([null, 'noch offen']) // 1.5.: keine Werte
    const d = beantworten(s, 'duengung', 2026, { heute: HEUTE })
    expect(d.spalten.at(-1)).toBe('Regen seither')
    expect(d.zeilen.find((z) => z.parcel?.id === 'a')?.werte.at(-1)).toBe('3.5 mm (bis 14.6.)')
    expect(d.zeilen.find((z) => z.parcel?.id === 'c')?.werte.at(-1)).toBe('') // nie gedüngt
    const r = beantworten(s, 'regen', 2026, { seit: '2026-06-01', heute: HEUTE })
    expect(r.spalten).toEqual(['Kennzahl', 'Wert'])
    expect(r.zeilen.map((z) => z.werte)).toEqual([
      ['Niederschlag', '9.7 mm (Werte bis 14.6.2026)'],
      ['Regentage (ab 1 mm)', '3 von 14 Tagen mit Wert'],
      ['Letzter Regen', 'vor 5 Tagen, 11.6.2026 (3 mm)'],
      ['Längste Trockenzeit', '6 Tage, 4.6.–9.6.2026'],
      ['Grösster Tageswert', '5 mm am 3.6.2026'],
      ['Quelle', 'MeteoSchweiz (1-km-Gitter), über graswachstum.ch'],
    ])
    // von Hand geht vor und wird genannt
    s.put('daily_farm_log', { id: 'l', entry_date: '2026-06-12', niederschlag_mm: 2 })
    expect(beantworten(s, 'regen', 2026, { seit: '2026-06-01', heute: HEUTE }).zeilen.map((z) => z.werte[1])).toEqual([
      '11.7 mm (Werte bis 14.6.2026)',
      '4 von 14 Tagen mit Wert',
      'vor 4 Tagen, 12.6.2026 (2 mm)',
      '6 Tage, 4.6.–9.6.2026',
      '5 mm am 3.6.2026',
      'MeteoSchweiz (1-km-Gitter), über graswachstum.ch; 1 Tag von Hand',
    ])
  })
})
