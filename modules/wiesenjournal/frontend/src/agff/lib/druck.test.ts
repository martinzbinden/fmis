import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { saveFertilizationEntry } from './fertilization'
import { druckSeite, mondPhase, seitenTage, wetterZeichen } from './druck'

describe('Druck im Format des AGFF-Wiesenjournals', () => {
  it('Seiten: drei Monate, Winter Jan–Feb plus Dezember', () => {
    const f = seitenTage(2026, 'fruehling')
    expect(f[0]).toBe('2026-03-01')
    expect(f[f.length - 1]).toBe('2026-05-31')
    expect(f).toHaveLength(92)
    const w = seitenTage(2026, 'winter')
    expect(w[0]).toBe('2026-01-01')
    expect(w).toContain('2026-12-31')
    expect(w).not.toContain('2026-03-01')
  })
  it('Wetter und Mond als Zeichen', () => {
    expect(wetterZeichen('sonnig')).toBe('O')
    expect(wetterZeichen('Regen am Abend')).toBe('/')
    // mittlere Phase: auf ±1 Tag genau (Neumond 18.1.2026, Vollmond 1.2.2026)
    const um = (d: string) => [-1, 0, 1].map((n) => mondPhase(new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)))
    expect(um('2026-01-18')).toContain('●')
    expect(um('2026-02-01')).toContain('○')
    expect(mondPhase('2026-01-22')).toBe('')
  })
  it('Zeilen: Weide je Tierart, Eingrasen als /, Düngung mit Menge und Kürzel, Gaben in N verfügbar je ha', async () => {
    const s = await memoryDb()
    const p = s.put('parcels', { id: 'k', season_year: 2026, name: 'Kuhmatt', area_a: 60, category: 'futter', wiesentyp: 'Engl. Raigras', intensitaet: 'i' })
    s.put('usage_entries', { id: 'w', parcel_id: 'k', entry_date: '2026-04-15', usage_type: 'weide', animal_category: 'kuehe' })
    s.put('usage_entries', { id: 'r', parcel_id: 'k', entry_date: '2026-04-15', usage_type: 'weide', animal_category: 'rinder' })
    s.put('usage_entries', { id: 'e', parcel_id: 'k', entry_date: '2026-05-02', usage_type: 'eingrasen' })
    s.put('usage_entries', { id: 's', parcel_id: 'k', entry_date: '2026-05-03', usage_type: 'silage' })
    const t = s.rows('fertilizer_types').find((x) => x.unit === 'm3')!
    saveFertilizationEntry(s, {
      id: null, anchorParcel: p, entry_date: '2026-03-08', season_year: 2026, type: t, amount: 12, container_count: null,
      container_size: null, dilution: null, gabe_number: null, notes: null, extent_type: 'parcel', extra_parcels: [], geometry: null,
    })
    const seite = druckSeite(s, 2026, 'fruehling')
    const z = seite.zeilen[0]
    expect(z).toMatchObject({ no: 1, parcel: { name: 'Kuhmatt' } })
    expect(z.nutzung.get('2026-04-15')).toBe('XY')
    expect(z.nutzung.get('2026-05-02')).toBe('/')
    expect(z.nutzung.get('2026-05-03')).toBe('S')
    expect(z.duengung.get('2026-03-08')).toBe(`12 ${t.code}`)
    expect(z.gaben).toHaveLength(1)
    expect(z.total).toBe(z.gaben[0])
    expect(seite.laufhof.map((l) => l.kategorie)).toEqual(expect.arrayContaining(['kuehe', 'rinder']))
    expect(seite.laufhof.find((l) => l.kategorie === 'kuehe')!.werte.get('2026-04-15')).toBe('X')
  })
  it('Niederschlag: von Hand vor automatisch, ganze mm, Hand markiert, Summe der Seite', async () => {
    const s = await memoryDb()
    s.put('parcels', { id: 'k', season_year: 2026, name: 'Kuhmatt', area_a: 60, category: 'futter' })
    s.put('daily_farm_log', { id: 'l1', entry_date: '2026-11-12', niederschlag_mm: 15 })
    s.put('daily_farm_log', { id: 'l2', entry_date: '2026-11-13', niederschlag_mm: 0 })
    const auto: Record<string, number> = { '2026-11-11': 2.1, '2026-11-12': 12.4, '2026-11-13': 3, '2026-11-14': 0.4 }
    const seite = druckSeite(s, 2026, 'herbst', (d) => auto[d] ?? null)
    expect(seite.regen.get('2026-11-11')).toBe('2')
    expect(seite.regen.get('2026-11-12')).toBe('15') // von Hand vor 12.4
    expect(seite.regen.has('2026-11-13')).toBe(false) // 0 von Hand vor 3 automatisch
    expect(seite.regen.has('2026-11-14')).toBe(false) // unter 0.5 mm leer
    expect([...seite.regenHand].sort()).toEqual(['2026-11-12', '2026-11-13'])
    expect(seite.regenSumme).toBe(18) // 2.1 + 15 + 0 + 0.4 = 17.5 → 18
    expect(druckSeite(s, 2026, 'fruehling', () => null).regenSumme).toBeNull()
  })
})
