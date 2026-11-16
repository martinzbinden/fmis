import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { brauchtAbruf, fmtRegen, regenAktualisieren, regenAm, regenHolen, regenJahr, regenKennzahlen, regenMonate, regenStand, regenSumme, regenTag, regenZuruecksetzen, REGEN_KEY, standortFuer, zelleFuer, type RegenSpeicher } from './regen'
import { memoryDb } from '../test/helpers'

// Fixture: Ausschnitt von apps.graswachstum.ch (src/test/fixtures/graswachstum/LIESMICH.md), nie live
const fx = (n: string) => readFileSync(new URL(`../test/fixtures/graswachstum/niederschlag_2026/${n}`, import.meta.url), 'utf8')
function fixtureFetch(log: string[] = []) {
  return async (url: string) => {
    log.push(url)
    const m = url.match(/^https:\/\/apps\.graswachstum\.ch\/growth\/ebenen\/tage\/niederschlag_2026\/(index|3_2|4_2)\.json$/)
    if (!m) return new Response('nicht gefunden', { status: 404 })
    return new Response(fx(`${m[1]}.json`), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

// Demohof im Grossen Moos (scripts/demo-gelan.mjs) und Rütti, Zollikofen
const DEMO = { lng: 7.1889, lat: 46.9841 }
const RUETTI = { lng: 7.4597, lat: 46.9934 }
const quadrat = (lng: number, lat: number, d = 0.001) =>
  JSON.stringify({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] })

beforeEach(() => regenZuruecksetzen())

describe('Regen von graswachstum.ch', () => {
  it('Zelle im Gitter, ausserhalb null', () => {
    const ix = JSON.parse(fx('index.json'))
    expect(zelleFuer(ix, DEMO.lng, DEMO.lat)).toEqual({ col: 60, row: 45 })
    expect(zelleFuer(ix, RUETTI.lng, RUETTI.lat)).toEqual({ col: 72, row: 45 })
    expect(zelleFuer(ix, 2.35, 48.85)).toBeNull() // Paris
  })

  it('Standort: Median der Parzellenmitten, eine ferne Alp verschiebt ihn nicht', () => {
    const p = (lng: number, lat: number, season_year = 2026) => ({ season_year, base_geometry: quadrat(lng, lat) })
    const ort = standortFuer([p(7.18, 46.98), p(7.19, 46.985), p(7.2, 46.99), p(8.6, 46.6)], 2026)!
    expect(ort.lng).toBeCloseTo(7.1955, 2)
    expect(ort.lat).toBeCloseTo(46.9875, 2)
    // ohne Parzellen im Jahr: nächstliegendes Jahr
    expect(standortFuer([p(7.18, 46.98, 2025)], 2026)?.lng).toBeCloseTo(7.1805, 3)
    expect(standortFuer([{ season_year: 2026, base_geometry: null }], 2026)).toBeNull()
  })

  it('Tageswerte holen: Index und eine Kachel, Zehntel-mm', async () => {
    const log: string[] = []
    const e = await regenHolen(2026, DEMO.lng, DEMO.lat, fixtureFetch(log), new Date('2026-11-16T08:00:00Z'))
    expect(log).toEqual([
      'https://apps.graswachstum.ch/growth/ebenen/tage/niederschlag_2026/index.json',
      'https://apps.graswachstum.ch/growth/ebenen/tage/niederschlag_2026/3_2.json',
    ])
    expect(e.fehlt).toBe(false)
    expect(e.zelle).toBe('60_45')
    expect(e.start).toBe('2026-01-01')
    expect(e.mm10).toHaveLength(318)
    const sp: RegenSpeicher = { 2026: e }
    expect(regenAm(sp, '2026-01-01')).toBe(e.mm10[0]! / 10) // Tag 0 = start
    expect(regenAm(sp, '2026-11-09')).toBe(4.2) // Fixture: 42 Zehntel
    expect(regenAm(sp, '2026-11-11')).toBe(2.1)
    expect(regenAm(sp, '2026-11-12')).toBe(12.4)
    expect(regenAm(sp, '2026-11-13')).toBe(0) // trocken: 0, nicht leer
    expect(regenAm(sp, '2026-11-14')).toBe(0.8)
    expect(regenAm(sp, '2026-11-15')).toBeNull() // noch nicht da
    expect(regenAm(sp, '2025-11-14')).toBeNull() // anderes Jahr
    expect(regenStand(e)).toBe('2026-11-14')
    const summe = e.mm10.reduce<number>((a, b) => a + (b ?? 0), 0) / 10
    expect(summe).toBeCloseTo(529.6, 1)
  })

  it('Jahr ohne Daten, Standort ausserhalb, Fehler', async () => {
    const leer = await regenHolen(2024, DEMO.lng, DEMO.lat, fixtureFetch())
    expect(leer.fehlt).toBe(true)
    const aussen = await regenHolen(2026, 2.35, 48.85, fixtureFetch())
    expect(aussen).toMatchObject({ fehlt: true, zelle: null })
    await expect(regenHolen(2026, DEMO.lng, DEMO.lat, async () => new Response('x', { status: 500 }))).rejects.toThrow(/Fehler 500/)
    await expect(regenHolen(2026, DEMO.lng, DEMO.lat, async () => { throw new TypeError('Failed to fetch') })).rejects.toThrow(/nicht erreichbar/)
    await expect(regenHolen(2026, DEMO.lng, DEMO.lat, async () => new Response('{"a":1}'))).rejects.toThrow(/unbekanntes Format/)
  })

  it('Abruf nur wenn nötig: Alter, anderes Jahr, andere Zelle', async () => {
    const jetzt = new Date('2026-11-16T08:00:00Z')
    const e = await regenHolen(2026, DEMO.lng, DEMO.lat, fixtureFetch(), jetzt)
    expect(brauchtAbruf(undefined, 2026, DEMO, jetzt)).toBe(true)
    expect(brauchtAbruf(e, 2026, DEMO, new Date('2026-11-16T12:00:00Z'))).toBe(false)
    expect(brauchtAbruf(e, 2026, DEMO, new Date('2026-11-16T15:00:00Z'))).toBe(true) // älter als 6 h
    expect(brauchtAbruf(e, 2026, RUETTI, new Date('2026-11-16T09:00:00Z'))).toBe(true) // andere Zelle
    expect(brauchtAbruf(e, 2027, DEMO, jetzt)).toBe(false) // Zukunft
    expect(brauchtAbruf({ ...e, geholt: '2026-11-01T00:00:00Z' }, 2025, DEMO, jetzt)).toBe(false) // früheres Jahr: 30 Tage
  })

  it('Aktualisieren legt die Werte auf dem Gerät ab (nicht in der Cloud), Handeintrag bleibt unberührt', async () => {
    const s = await memoryDb()
    const jetzt = new Date('2026-11-16T08:00:00Z')
    expect(await regenAktualisieren(s, 2026, { fetch: fixtureFetch(), jetzt, online: true })).toBe('ohne-standort')
    s.put('parcels', { id: 'p1', season_year: 2026, name: 'Rain', base_geometry: quadrat(DEMO.lng, DEMO.lat) })
    expect(await regenAktualisieren(s, 2026, { fetch: fixtureFetch(), jetzt, online: false })).toBe('offline')
    const log: string[] = []
    const [a, b] = await Promise.all([
      regenAktualisieren(s, 2026, { fetch: fixtureFetch(log), jetzt, online: true }),
      regenAktualisieren(s, 2026, { fetch: fixtureFetch(log), jetzt, online: true }),
    ])
    expect([a, b]).toEqual(['geholt', 'geholt'])
    expect(log).toHaveLength(2) // nur einmal geholt
    expect(regenAm(s.getSetting<RegenSpeicher>(REGEN_KEY, {}), '2026-11-12')).toBe(12.4)
    expect(s.snapshot().settings[REGEN_KEY]).toBeTruthy() // Gerät
    expect(s.rows('einstellungen').find((r) => r.id === REGEN_KEY)).toBeUndefined() // nicht in der Cloud-Tabelle
    expect(s.rows('daily_farm_log')).toHaveLength(0)
    expect(await regenAktualisieren(s, 2026, { fetch: fixtureFetch(log), jetzt, online: true })).toBe('aktuell')
    // Netzfehler: Stand bleibt, kurze Pause
    const spaeter = new Date('2026-11-16T20:00:00Z')
    expect(await regenAktualisieren(s, 2026, { fetch: async () => new Response('', { status: 502 }), jetzt: spaeter, online: true })).toBe('fehler')
    expect(await regenAktualisieren(s, 2026, { fetch: fixtureFetch(), jetzt: spaeter, online: true })).toBe('pause')
    expect(regenAm(s.getSetting<RegenSpeicher>(REGEN_KEY, {}), '2026-11-12')).toBe(12.4)
  })

  it('Tageswert und 7-Tage-Summe: von Hand geht vor, fehlende Tage gezählt', async () => {
    const sp: RegenSpeicher = { 2026: await regenHolen(2026, DEMO.lng, DEMO.lat, fixtureFetch()) }
    expect(regenTag(sp, '2026-11-12', null)).toEqual({ mm: 12.4, vonHand: false })
    expect(regenTag(sp, '2026-11-12', 15)).toEqual({ mm: 15, vonHand: true })
    expect(regenTag(sp, '2026-11-13', 0)).toEqual({ mm: 0, vonHand: true }) // 0 von Hand ist ein Wert
    expect(regenTag(sp, '2026-11-16', null)).toBeNull()
    // 8.–14.11.: 0.2 + 4.2 + 1.2 + 2.1 + 12.4 + 0 + 0.8 = 20.9
    expect(regenSumme(sp, '2026-11-14', 7, () => null)).toEqual({ mm: 20.9, fehlen: 0, auto: 7, letzter: '2026-11-14' })
    // von Hand 15 statt 12.4 am 12.11.
    expect(regenSumme(sp, '2026-11-14', 7, (d) => (d === '2026-11-12' ? 15 : null))).toMatchObject({ mm: 23.5, auto: 6 })
    // 10.–16.11.: 15. und 16. fehlen noch
    expect(regenSumme(sp, '2026-11-16', 7, () => null)).toEqual({ mm: 16.5, fehlen: 2, auto: 5, letzter: '2026-11-14' })
    expect(regenSumme({}, '2026-11-16', 7, () => null)).toEqual({ mm: 0, fehlen: 7, auto: 0, letzter: null })
  })

  it('Jahr und Monatssummen für die Auswertung', async () => {
    const e = await regenHolen(2026, DEMO.lng, DEMO.lat, fixtureFetch())
    const sp: RegenSpeicher = { 2026: e }
    const zeilen = regenJahr(sp, 2026, '2026-11-16', (d) => (d === '2026-11-12' ? 15 : null))
    expect(zeilen).toHaveLength(320) // 1.1.–16.11.
    expect(zeilen.find((z) => z.datum === '2026-11-12')).toEqual({ datum: '2026-11-12', mm: 15, quelle: 'hand' })
    expect(zeilen.find((z) => z.datum === '2026-11-13')).toEqual({ datum: '2026-11-13', mm: 0, quelle: 'auto' })
    expect(zeilen.at(-1)).toEqual({ datum: '2026-11-16', mm: null, quelle: null })
    const monate = regenMonate(zeilen)
    expect(monate.map((m) => m.monat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const nov = monate[10]
    expect(nov).toMatchObject({ tage: 16, mitWert: 14, vonHand: 1 })
    // Jahressumme: Fixture 529.6 mm, am 12.11. von Hand 15 statt 12.4
    expect(monate.reduce((a, m) => a + m.mm, 0)).toBeCloseTo(529.6 + 2.6, 1)
    const jan = monate[0]
    const janWerte = e.mm10.slice(0, 31).map((v) => (v ?? 0) / 10)
    expect(jan.mm).toBeCloseTo(janWerte.reduce((a, b) => a + b, 0), 1)
    expect(jan.regentage).toBe(janWerte.filter((v) => v >= 1).length)
    // Jahr ohne Daten, Tage vor dem Jahr
    expect(regenJahr({}, 2025, '2026-11-16', () => null)).toHaveLength(365)
    expect(regenJahr({}, 2027, '2026-11-16', () => null)).toHaveLength(0)
  })

  it('Kennzahlen über einen Zeitraum: Summe, Regentage, letzter Regen, Trockenperiode, grösster Tag', async () => {
    const sp: RegenSpeicher = { 2026: await regenHolen(2026, DEMO.lng, DEMO.lat, fixtureFetch()) }
    // 8.–16.11.: 0.2, 4.2, 1.2, 2.1, 12.4, 0, 0.8, –, –; am 9.11. von Hand 0
    const k = regenKennzahlen(sp, '2026-11-08', '2026-11-16', (d) => (d === '2026-11-09' ? 0 : null))
    expect(k).toMatchObject({ tage: 9, mitWert: 7, vonHand: 1, mm: 16.7, regentage: 3, letzter: '2026-11-14' })
    expect(k.letzterRegen).toEqual({ datum: '2026-11-12', mm: 12.4 })
    expect(k.groesster).toEqual({ datum: '2026-11-12', mm: 12.4 })
    expect(k.trocken).toEqual({ tage: 2, von: '2026-11-08', bis: '2026-11-09' }) // 13.–14. auch 2, die erste zählt
    const leer = regenKennzahlen({}, '2026-11-01', '2026-11-03', () => null)
    expect(leer).toMatchObject({ tage: 3, mitWert: 0, mm: 0, letzterRegen: null, trocken: null, groesster: null, letzter: null })
  })

  it('mm-Anzeige', () => {
    expect(fmtRegen(12)).toBe('12')
    expect(fmtRegen(0.4)).toBe('0.4')
    expect(fmtRegen(13.700000001)).toBe('13.7')
  })
})
