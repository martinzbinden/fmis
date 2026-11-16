import { describe, expect, it } from 'vitest'
import { aufenthalteVonTiere, einstellungsId, herdenVonTiere, laufhofZeichen, nachFmis, vonFmis, type TiereDaten } from './abbildung'

const g = (id: string, species = 'schafe') => ({ id, name: `Gruppe ${id}`, species, active: true, sort_order: 0, notes: null, updated_at: '2026-01-01T00:00:00Z', deleted_at: null })
const stay = (id: string, slot: 'stall' | 'weide', from: string, to: string | null, extra: Partial<TiereDaten['stays'][number]> = {}) => ({
  id, group_id: 'g1', slot, location_id: slot === 'stall' ? 'l1' : null, parcel_id: slot === 'weide' ? 'p1' : null, day_only: false,
  from_date: from, to_date: to, updated_at: '2026-01-01T00:00:00Z', deleted_at: null, ...extra,
})

describe('Abbildung FMIS ↔ AGFF', () => {
  it('Laufhof: Zeichen bleiben, altes Häkchen true = L, false = automatisch', () => {
    expect(['X', 'L', '0', true, 'true', false, 'false', null].map(laufhofZeichen)).toEqual(['X', 'L', '0', 'L', 'L', null, null, null])
  })

  it('Gaben: Spalten umbenannt, geplante bleiben draussen, zurück nur FMIS-Spalten', () => {
    const r = vonFmis('fertilization_entries', { id: 'a', duengung_code: 'RGv', track_id: 't', is_planned: false, incomplete: null })!
    expect(r).toMatchObject({ code: 'RGv', trip_id: 't', incomplete: false })
    expect(r).not.toHaveProperty('duengung_code')
    expect(vonFmis('fertilization_entries', { id: 'b', is_planned: true })).toBeNull()
    const z = nachFmis('fertilization_entries', { ...r, herde: 'x', updated_at: 'egal' }, ['id', 'duengung_code', 'track_id', 'incomplete'])
    expect(z).toEqual({ id: 'a', duengung_code: 'RGv', track_id: 't', incomplete: false })
  })

  it('Parzellen: source fields ↔ gelan, gespeicherte Quelle bleibt beim Zurückschreiben', () => {
    const r = vonFmis('parcels', { id: 'p', source: 'fields', farm_id: 'F1', favorit: null })!
    expect(r).toMatchObject({ source: 'gelan', farm_uid: 'F1', favorit: false })
    expect(nachFmis('parcels', { ...r, favorit: true }, ['id', 'source', 'farm_id', 'favorit'])).toEqual({ id: 'p', farm_id: 'F1', favorit: true })
  })

  it('Einstellungen: gleiche id für denselben Schlüssel, Form einer uuid', async () => {
    const a = await einstellungsId('klein')
    expect(a).toBe(await einstellungsId('klein'))
    expect(a).not.toBe(await einstellungsId('weide_neu_tage'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('Herde: Kategorie mit den meisten Tieren, Anzahl aus dem Bestand', () => {
    const t: TiereDaten = { groups: [g('g1', 'rinder')], stays: [], locations: [], bestand: new Map([['g1', new Map([['kuehe', 12], ['kaelber', 3]])]]) }
    expect(herdenVonTiere(t)[0]).toMatchObject({ id: 'g1', kategorie: 'kuehe', anzahl: 15 })
  })

  it('Stall füllt nur die Lücken zwischen den Weiden', () => {
    const t: TiereDaten = {
      groups: [g('g1')],
      stays: [stay('s', 'stall', '2026-01-01', null), stay('w1', 'weide', '2026-04-10', '2026-04-20'), stay('w2', 'weide', '2026-05-01', null)],
      locations: [{ id: 'l1', laufhof: 'staendig' }],
      bestand: new Map(),
    }
    const a = aufenthalteVonTiere(t).sort((x, y) => (x.von < y.von ? -1 : 1))
    expect(a.map((x) => [x.ort, x.von, x.bis, x.auslauf])).toEqual([
      ['stall', '2026-01-01', '2026-04-09', 'L'],
      ['weide', '2026-04-10', '2026-04-20', null],
      ['stall', '2026-04-21', '2026-04-30', 'L'],
      ['weide', '2026-05-01', null, null],
    ])
    expect(a[0].id).toBe('s')
    expect(a[2].id).toBe('s~1')
    expect(a[2].fmis_slot).toBe('stall')
  })

  it('Weide an einem Ort (Alp) gilt nicht als Weide auf einer Parzelle', () => {
    const t: TiereDaten = { groups: [g('g1')], stays: [stay('w', 'weide', '2026-06-01', null, { parcel_id: null, location_id: 'alp' })], locations: [], bestand: new Map() }
    expect(aufenthalteVonTiere(t)[0]).toMatchObject({ ort: 'stall', fmis_slot: 'weide_ort' })
  })
})
