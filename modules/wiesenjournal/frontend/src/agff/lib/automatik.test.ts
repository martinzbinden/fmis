import { describe, expect, it } from 'vitest'
import { memoryDb } from '../test/helpers'
import { automatikSpeichern, automatikVorschlag, vorgabeWahl } from './automatik'
import { herdeAnlegen, aufenthaltAm, nutzungen } from './herden'
import { laufhofSetzen } from './laufhof'

const HEUTE = '2026-06-16'
const GESTERN = '2026-06-15'

async function setup() {
  const s = await memoryDb()
  for (const [id, name] of [['a', 'Rain'], ['b', 'Moos'], ['c', 'Bach']]) s.put('parcels', { id, season_year: 2026, name, area_a: 100, category: 'futter' })
  // Rinder von Hand seit drei Tagen auf Moos
  for (const d of ['2026-06-13', '2026-06-14', GESTERN]) s.put('usage_entries', { id: `m${d}`, parcel_id: 'b', entry_date: d, usage_type: 'weide', animal_category: 'rinder', animal_count: 9 })
  // Herde Kühe seit 8.6. auf Rain (läuft offen weiter)
  const kuehe = herdeAnlegen(s, { name: 'Milchkühe', kategorie: 'kuehe', anzahl: 30 }, { ort: 'weide', parcel_id: 'a' }, '2026-06-08')
  // Schafe gestern im Stall mit Laufhof von Hand
  laufhofSetzen(s, GESTERN, 'schafe', 'L')
  return { s, kuehe, parcels: s.rows('parcels') }
}

describe('Weide/Auslauf-Automatik', () => {
  it('leitet her: Herde bleibt, Weide wie gestern mit Dauer, Laufhof aus Weide, gestern und Frage', async () => {
    const { s, kuehe, parcels } = await setup()
    const a = automatikVorschlag(s, HEUTE, parcels, ['kuehe', 'rinder', 'schafe', 'kaelber'])
    expect(a.herden).toHaveLength(1)
    expect(a.herden[0]).toMatchObject({ herde: { id: kuehe }, seit: 9 })
    expect(a.weiden).toHaveLength(1)
    expect(a.weiden[0]).toMatchObject({ parcel: { id: 'b' }, tiere: { animal_category: 'rinder', animal_count: 9 }, tage: 3 })
    const lh = Object.fromEntries(a.laufhof.map((l) => [l.kategorie, `${l.quelle}:${l.anzeige}`]))
    expect(lh).toEqual({ kuehe: 'weide:X', rinder: 'weide:X', schafe: 'gestern:L', kaelber: 'frage:' })
    // nichts gespeichert, bevor man bestätigt
    expect(nutzungen(s, HEUTE, HEUTE).filter((u) => !u.herde_aufenthalt_id)).toHaveLength(0)
  })
  it('bestätigen: Weide gespeichert, Laufhof gesetzt, Herde umgezogen; ein Rückgängig für alles', async () => {
    const { s, kuehe, parcels } = await setup()
    const a = automatikVorschlag(s, HEUTE, parcels, ['kuehe', 'rinder', 'schafe', 'kaelber'])
    const w = vorgabeWahl(a)
    w.weiden[a.weiden[0].key].tiere = { ...w.weiden[a.weiden[0].key].tiere, animal_count: 11 } // Anzahl geändert
    w.herden[kuehe] = { art: 'weide', parcel_id: 'c' } // Kühe heute auf Bach
    w.laufhof.kaelber = '0' // die eine Frage beantwortet
    const r = automatikSpeichern(s, a, w)
    expect(r.text).toMatch(/1 Herde, 1 Weide, Laufhof Schafe L, Laufhof Kälber 0/)
    expect(s.rows('usage_entries').find((u) => u.parcel_id === 'b' && u.entry_date === HEUTE)).toMatchObject({ animal_category: 'rinder', animal_count: 11 })
    expect(aufenthaltAm(s, kuehe, HEUTE)?.parcel_id).toBe('c')
    expect(aufenthaltAm(s, kuehe, GESTERN)?.parcel_id).toBe('a')
    r.rueck()
    expect(s.rows('usage_entries').filter((u) => u.entry_date === HEUTE)).toHaveLength(0)
    expect(aufenthaltAm(s, kuehe, HEUTE)?.parcel_id).toBe('a')
    expect(s.rows('daily_farm_log').find((l) => l.entry_date === HEUTE)?.laufhof_schafe ?? null).toBeNull()
  })
})
