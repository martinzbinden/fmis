import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { herdeAnlegen } from './herden'
import { istKlein, KLEIN_KEY, kleinEinstellung, kleineAusblenden, kleinStand, parzellenMitDaten } from './klein'

async function setup() {
  const s = await memoryDb()
  const p = (id: string, area_a: number | null, extra = {}) => s.put('parcels', { id, season_year: 2026, name: id, area_a, ...extra })
  p('gross', 120)
  p('streifen', 4.5)
  p('hecke', 9.99)
  p('grenze', 10)
  p('ohne', null)
  p('laufhof', 2, { immer_zeigen: true })
  p('gebraucht', 3)
  p('herde', 6)
  p('duenger', 5)
  s.put('usage_entries', { id: 'u', parcel_id: 'gebraucht', entry_date: '2026-05-01', usage_type: 'eingrasen' })
  s.put('usage_entries', { id: 'alt', parcel_id: 'streifen', entry_date: '2025-05-01', usage_type: 'eingrasen' })
  herdeAnlegen(s, { name: 'Rinder', kategorie: 'rinder', anzahl: 5 }, { ort: 'weide', parcel_id: 'herde' }, '2026-06-01')
  s.put('fertilization_entries', { id: 'f', parcel_id: 'gross', entry_date: '2026-04-01', code: 'G' })
  s.put('fertilization_shares', { id: 'fs', entry_id: 'f', parcel_id: 'duenger', area_a: 5 })
  return s
}
const namen = (xs: { id: string }[]) => xs.map((x) => x.id).sort()

describe('Kleine Parzellen ausblenden', () => {
  it('Vorgabe: aus, Grenze 10 a; ungültige Grenze fällt auf 10 zurück', async () => {
    const s = await setup()
    expect(kleinEinstellung(s)).toEqual({ an: false, grenze_a: 10 })
    s.setSetting(KLEIN_KEY, { an: true, grenze_a: 'x' })
    expect(kleinEinstellung(s)).toEqual({ an: true, grenze_a: 10 })
  })

  it('istKlein: unter der Grenze, ohne Fläche nie', () => {
    expect(istKlein({ area_a: 9.99 }, 10)).toBe(true)
    expect(istKlein({ area_a: 10 }, 10)).toBe(false)
    expect(istKlein({ area_a: null }, 10)).toBe(false)
  })

  it('aus: alles sichtbar, nichts ausgeblendet', async () => {
    const s = await setup()
    const r = kleineAusblenden(s.rows('parcels'), kleinStand(s, 2026))
    expect(r.sichtbar).toHaveLength(9)
    expect(r.ausgeblendet).toHaveLength(0)
  })

  it('an: kleine ohne Daten weg; Einträge im Jahr, Herde, Düngeranteil und «immer zeigen» bleiben', async () => {
    const s = await setup()
    s.setSetting(KLEIN_KEY, { an: true, grenze_a: 10 })
    const r = kleineAusblenden(s.rows('parcels'), kleinStand(s, 2026))
    expect(namen(r.ausgeblendet)).toEqual(['hecke', 'streifen']) // «streifen» hat nur einen Eintrag im Vorjahr
    expect(namen(r.sichtbar)).toEqual(['duenger', 'gebraucht', 'grenze', 'gross', 'herde', 'laufhof', 'ohne'])
  })

  it('zeigen: alle sichtbar, die Ausgeblendeten trotzdem gezählt; gewählte bleiben immer', async () => {
    const s = await setup()
    s.setSetting(KLEIN_KEY, { an: true, grenze_a: 5 })
    const stand = kleinStand(s, 2026)
    expect(namen(kleineAusblenden(s.rows('parcels'), stand).ausgeblendet)).toEqual(['streifen'])
    const z = kleineAusblenden(s.rows('parcels'), stand, true)
    expect(z.sichtbar).toHaveLength(9)
    expect(namen(z.ausgeblendet)).toEqual(['streifen'])
    expect(kleineAusblenden(s.rows('parcels'), stand, false, ['streifen']).ausgeblendet).toHaveLength(0)
  })

  it('parzellenMitDaten: Zeitraum begrenzt, Herde auch bei offenem Aufenthalt', async () => {
    const s = await setup()
    expect([...parzellenMitDaten(s, '2026-01-01', '2026-12-31')].sort()).toEqual(['duenger', 'gebraucht', 'gross', 'herde'])
    expect([...parzellenMitDaten(s, '2025-01-01', '2025-12-31')]).toEqual(['streifen'])
    expect(parzellenMitDaten(s, '2027-01-01', '2027-12-31').has('herde')).toBe(true)
  })
})
