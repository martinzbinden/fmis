import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { einfuegen, fuellen, kopieren, leeren, monatSprung, tageZwischen, zeilenZwischen, zellbreite } from './raster'

async function setup() {
  const s = await memoryDb()
  for (const [id, name] of [['a', 'Rain'], ['b', 'Moos'], ['c', 'Bach']]) s.put('parcels', { id, season_year: 2026, name, area_a: 100 })
  s.put('usage_entries', { id: 'u1', parcel_id: 'a', entry_date: '2026-06-15', usage_type: 'weide', animal_category: 'rinder', animal_count: 8 })
  return s
}
const am = (s: Awaited<ReturnType<typeof setup>>, pid: string, d: string) => s.rows('usage_entries').filter((u) => u.parcel_id === pid && u.entry_date === d)

describe('Raster plus (Etappe 4)', () => {
  it('Zeitraum: Zellbreite, Monatssprung, Bereiche', () => {
    expect(zellbreite('woche', 350)).toBe(50)
    expect(zellbreite('monat', 1240)).toBe(40)
    expect(zellbreite('saison', 1240)).toBe(14)
    expect(monatSprung('2026-06-16', 1)).toBe('2026-07-01')
    expect(monatSprung('2026-01-10', -1)).toBe('2025-12-01')
    expect(tageZwischen('2026-06-17', '2026-06-15')).toEqual(['2026-06-15', '2026-06-16', '2026-06-17'])
    expect(zeilenZwischen(['a', 'b', 'c'], 'c', 'a')).toEqual(['a', 'b', 'c'])
  })
  it('Kopieren und Einfügen in einen Bereich über zwei Parzellen, Rückgängig', async () => {
    const s = await setup()
    const v = kopieren(s, 'a', '2026-06-15')
    const r = einfuegen(s, v, { pids: ['b', 'c'], tage: ['2026-06-16', '2026-06-17'] })
    expect(r.anzahl).toBe(4)
    expect(am(s, 'c', '2026-06-17')[0]).toMatchObject({ usage_type: 'weide', animal_category: 'rinder', animal_count: 8 })
    r.rueck()
    expect(am(s, 'c', '2026-06-17')).toHaveLength(0)
  })
  it('Füllen wie links und Leeren mit Rückgängig', async () => {
    const s = await setup()
    const f = fuellen(s, { pids: ['a'], tage: ['2026-06-16', '2026-06-17'] })
    expect(f.anzahl).toBe(2)
    const l = leeren(s, { pids: ['a'], tage: ['2026-06-15', '2026-06-16', '2026-06-17'] })
    expect(l.anzahl).toBe(3)
    expect(am(s, 'a', '2026-06-15')).toHaveLength(0)
    l.rueck()
    expect(am(s, 'a', '2026-06-16')).toHaveLength(1)
  })
})
