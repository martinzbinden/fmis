import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { herdeAnlegen } from './herden'
import { saveFertilizationEntry } from './fertilization'
import { jahresband, vorTagen, wochenDesJahres } from './jahresband'

describe('Jahresband', () => {
  it('Wochen des Jahres: KW 1 bis 52/53, je Montag', () => {
    const w = wochenDesJahres(2026)
    expect(w[0]).toBe('2025-12-29')
    expect(w).toHaveLength(53)
    expect(wochenDesJahres(2025)).toHaveLength(52)
  })
  it('Weide als Tage je Woche (auch aus Herden), Schnitt als Buchstabe, Düngung, Kennzahlen', async () => {
    const s = await memoryDb()
    s.put('parcels', { id: 'a', season_year: 2026, name: 'Eichmatte', area_a: 200 })
    s.put('usage_entries', { id: 'u1', parcel_id: 'a', entry_date: '2026-06-16', usage_type: 'silage' })
    s.put('usage_entries', { id: 'u2', parcel_id: 'a', entry_date: '2026-06-01', usage_type: 'weide', animal_category: 'kuehe' })
    herdeAnlegen(s, { name: 'Rinder', kategorie: 'rinder', anzahl: 8 }, { ort: 'weide', parcel_id: 'a' }, '2026-06-01')
    const gt = s.rows('fertilizer_types').find((t) => t.unit === 'm3')!
    saveFertilizationEntry(s, {
      id: null, anchorParcel: s.get('parcels', 'a')!, entry_date: '2026-06-18', season_year: 2026, type: gt, amount: 40, container_count: null,
      container_size: null, dilution: null, gabe_number: null, notes: null, extent_type: 'parcel', extra_parcels: [], geometry: null,
    })
    const j = jahresband(s, 2026, s.rows('parcels'), '2026-06-20')
    const band = j.baender.get('a')!
    const kw = (d: string) => j.wochen.indexOf(d)
    // Woche vom 1.6.: Hand-Weide Kühe und Herde Rinder am selben Tag zählen als ein Tag; die Herde steht bis heute dort
    expect(band[kw('2026-06-01')].weide).toBe(7)
    expect(band[kw('2026-06-15')].schnitt?.buchstabe).toBe('S')
    expect(band[kw('2026-06-15')].duengung).toBe(true)
    expect(band[kw('2026-06-15')].ersterTag).toBe('2026-06-15')
    const k = j.kennzahlen.get('a')!
    expect(k.schnitte).toBe(1)
    expect(k.duengungen).toBe(1)
    expect(k.weidetage).toBeGreaterThanOrEqual(20) // Herde ab 1.6. bis zum echten Heute (weideAusHerden)
    expect(k.letzteDuengung?.datum).toBe('2026-06-18')
    expect(k.n_kg_ha).toBeGreaterThan(0)
  })
  it('vor Tagen', () => {
    expect(vorTagen('2026-06-16', '2026-06-16')).toBe('heute')
    expect(vorTagen('2026-06-15', '2026-06-16')).toBe('gestern')
    expect(vorTagen('2026-06-03', '2026-06-16')).toBe('vor 13 T.')
  })
})
