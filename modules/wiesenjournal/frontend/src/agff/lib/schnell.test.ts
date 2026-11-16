import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { gabeFuer, gabeText, KUERZEL, letzteGabe, letzteTiere, rueckgaengig, schnellErfassen, tageVonBis, tiereNachfragen } from './schnell'
import { loadFertilizerTypes, saveFertilizationEntry } from './fertilization'
import type { Parcel } from '../types'

const k = (key: string) => KUERZEL.find((x) => x.key === key)!

async function setup() {
  const s = await memoryDb()
  s.put('parcels', { id: 'p1', season_year: 2026, name: 'Hausmatte', area_a: 100 })
  s.put('parcels', { id: 'p2', season_year: 2026, name: 'Rain', area_a: 50 })
  return { s, p1: s.get('parcels', 'p1') as Parcel, p2: s.get('parcels', 'p2') as Parcel }
}

describe('Schnellerfassung', () => {
  it('Tage von–bis, auch rückwärts gezogen', () => {
    expect(tageVonBis('2026-05-03', '2026-05-01')).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
    expect(tageVonBis('2026-02-28', '2026-03-01')).toEqual(['2026-02-28', '2026-03-01'])
  })

  it('X: erster Weidegang seit N Tagen fragt nach Tieren, danach wie beim letzten Mal', async () => {
    const { s, p1 } = await setup()
    expect(tiereNachfragen(s, 'p1', '2026-05-01')).toBe(true)
    schnellErfassen(s, p1, ['2026-05-01', '2026-05-02'], k('X'), { tiere: { animal_category: 'rinder', animal_group: 'Jungvieh', animal_count: 12 } })
    expect(tiereNachfragen(s, 'p1', '2026-05-05')).toBe(false)
    expect(tiereNachfragen(s, 'p1', '2026-05-20', 14)).toBe(true)
    schnellErfassen(s, p1, ['2026-05-05'], k('X'))
    const u = s.rows('usage_entries').find((x) => x.entry_date === '2026-05-05')!
    expect(u).toMatchObject({ usage_type: 'weide', animal_category: 'rinder', animal_group: 'Jungvieh', animal_count: 12 })
    expect(letzteTiere(s)[0]).toMatchObject({ animal_category: 'rinder', animal_group: 'Jungvieh' })
  })

  it('S über drei Tage, Rückgängig entfernt alle', async () => {
    const { s, p1 } = await setup()
    const neu = schnellErfassen(s, p1, tageVonBis('2026-06-01', '2026-06-03'), k('S'))
    expect(neu).toHaveLength(3)
    expect(s.rows('usage_entries').map((u) => u.usage_type)).toEqual(['silage', 'silage', 'silage'])
    rueckgaengig(s, neu)
    expect(s.rows('usage_entries')).toHaveLength(0)
  })

  it('Gü mit der zuletzt verwendeten Sorte und Menge; Nährstoffe gerechnet; Rückgängig', async () => {
    const { s, p1, p2 } = await setup()
    expect(letzteGabe(s, 'guelle')).toBeNull()
    const rgk = loadFertilizerTypes(s).find((t) => t.code === 'RGk')!
    saveFertilizationEntry(s, {
      id: null, anchorParcel: p2, entry_date: '2026-04-01', season_year: 2026, type: rgk, amount: null, container_count: 3, container_size: 6.5,
      dilution: null, gabe_number: null, notes: null, extent_type: 'parcel', extra_parcels: [], geometry: null,
    })
    const g = letzteGabe(s, 'guelle')!
    // 3 Fass × 6.5 m³ = 19.5 m³ auf Rain (50 a) = 39 m³/ha
    expect(g).toMatchObject({ container_count: 3, container_size: 6.5, proHa: 39 })
    expect(g.type.code).toBe('RGk')
    expect(gabeText(g)).toBe('RGk 39 m³/ha')
    expect(letzteGabe(s, 'mist')).toBeNull()
    // auf Hausmatte (100 a): je Hektare umgerechnet, nicht 19.5 m³ wie zuletzt (Befund U6)
    expect(gabeText(g, p1)).toBe('RGk 39 m³ (39 m³/ha)')
    const neu = schnellErfassen(s, p1, ['2026-05-10'], k('Gü'), { gabe: g })
    const e = s.get('fertilization_entries', neu[0].id)!
    expect(e).toMatchObject({ code: 'RGk', container_count: null, amount: 39, parcel_id: 'p1' })
    expect(Number(e.n_kg)).toBeCloseTo(39 * 4.6, 1)
    // Parzelle ohne Fläche: Menge wie zuletzt
    expect(gabeFuer(g, { area_a: null })).toMatchObject({ container_count: 3, container_size: 6.5, umgerechnet: false })
    // kleine Parzelle 12 a: 39 × 0.12 = 4.68 → 4.5 m³ (auf 0.5 gerundet)
    expect(gabeFuer(g, { area_a: 12 }).amount).toBe(4.5)
    rueckgaengig(s, neu)
    expect(s.get('fertilization_entries', neu[0].id)).toBeNull()
    expect(s.rows('fertilization_shares').filter((x) => x.entry_id === neu[0].id)).toHaveLength(0)
  })
})
