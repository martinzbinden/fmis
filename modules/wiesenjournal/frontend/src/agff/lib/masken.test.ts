import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { duengenSpeichern, letzterGemeinsamerSchnitt, mengeProHa, offen, pflegeSpeichern, schnittNummer, schnittSpeichern, weideSpeichern } from './masken'
import { rueckgaengig } from './schnell'

async function setup() {
  const s = await memoryDb()
  const p = (id: string, name: string, area_a: number) => s.put('parcels', { id, season_year: 2026, name, area_a, category: 'futter' })
  return { s, a: p('a', 'Moos', 300), b: p('b', 'Bodenacher', 100), c: p('c', 'Hausmatte', 180) }
}

describe('Masken (Etappe 3)', () => {
  it('Düngen: eine Gabe auf mehrere Parzellen, nach Fläche verteilt; Rückgängig', async () => {
    const { s, a, b } = await setup()
    const guelle = s.rows('fertilizer_types').find((t) => t.unit === 'm3')!
    const e = { type: guelle, amount: null, container_count: 8, container_size: 5, dilution: null, parcels: [b, a], datum: '2026-06-16' }
    expect(mengeProHa(e)).toBe(10) // 40 m³ auf 4 ha
    const erfasst = duengenSpeichern(s, e)
    const f = s.get('fertilization_entries', erfasst[0].id)!
    expect(f.extent_type).toBe('parcels')
    expect(f.parcel_id).toBe('a') // Anker = grösste
    const anteile = s.rows('fertilization_shares').filter((x) => x.entry_id === f.id)
    expect(anteile.map((x) => [x.parcel_id, Number(x.area_a)]).sort()).toEqual([['a', 300], ['b', 100]])
    expect(Number(anteile.find((x) => x.parcel_id === 'a')!.n_kg)).toBeCloseTo(3 * Number(anteile.find((x) => x.parcel_id === 'b')!.n_kg), 5)
    rueckgaengig(s, erfasst)
    expect(s.rows('fertilization_entries')).toHaveLength(0)
  })
  it('Schnitt: Ertrag je Parzelle, Schnittnummer, Vorschlag wie letzter gemeinsamer Schnitt, Offen ohne Ertrag', async () => {
    const { s, a, b, c } = await setup()
    schnittSpeichern(s, { usage_type: 'silage', zeilen: [{ parcel: a, ertrag: 22 }, { parcel: b, ertrag: null }], einheit: 'rb', datum: '2026-05-10' })
    expect(schnittNummer(s, 'a', '2026-06-16')).toBe(2)
    expect(schnittNummer(s, 'c', '2026-06-16')).toBe(1)
    expect(letzterGemeinsamerSchnitt(s, '2026-06-16')).toMatchObject({ datum: '2026-05-10', usage_type: 'silage', parcelIds: ['a', 'b'] })
    const u = s.rows('usage_entries').find((x) => x.parcel_id === 'a')!
    expect(u).toMatchObject({ yield_amount: 22, yield_unit: 'rb' })
    expect(s.rows('usage_entries').find((x) => x.parcel_id === 'b')!.yield_unit).toBeNull()
    const o = offen(s, '2026-06-16')
    expect(o).toHaveLength(1)
    expect(o[0]).toMatchObject({ art: 'ertrag', text: 'Silage vom 10.5.: Bodenacher', parcelIds: ['b'] })
    void c
  })
  it('Weide von–bis auf mehreren Parzellen mit Tieren; Pflege mit Mittel', async () => {
    const { s, a, c } = await setup()
    const w = weideSpeichern(s, { parcels: [a, c], von: '2026-06-14', bis: '2026-06-16', tiere: { animal_category: 'rinder', animal_group: 'Jungvieh', animal_count: 12 }, tagweide: true })
    expect(w).toHaveLength(6)
    expect(s.rows('usage_entries').every((u) => u.usage_type === 'weide' && u.animal_category === 'rinder' && u.animal_count === 12 && u.day_only)).toBe(true)
    pflegeSpeichern(s, { usage_type: 'blacken_stechen', parcels: [a], datum: '2026-06-16', label: 'Harmony', wert: null })
    expect(s.rows('usage_entries').find((u) => u.usage_type === 'blacken_stechen')).toMatchObject({ parcel_id: 'a', label: 'Harmony' })
  })
})
