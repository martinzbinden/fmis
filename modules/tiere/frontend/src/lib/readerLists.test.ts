import { describe, expect, it } from 'vitest'
import { alertText, buildReaderLists, deviceText, MAX_ALERTS, vidText, type ReaderEntry } from './readerLists'

const today = '2026-11-12'
const entry = (p: Partial<ReaderEntry> = {}): ReaderEntry => ({
  earTag: 'CH113900000103',
  laufNr: '101',
  group: 'Ablammgruppe',
  facts: { lastBirth: '2026-03-12', pregnancy: { date: '2026-10-10', result: 'ja' } },
  ...p,
})

describe('deviceText', () => {
  it('Umlaute ausschreiben, Kommas und Leerraum weg, Unbekanntes als ?', () => {
    expect(deviceText('Lämmer,  Böcke')).toBe('Laemmer Boecke')
    expect(deviceText('Gruppe ñ')).toBe('Gruppe ?')
  })
})

describe('Gruppenwechsel', () => {
  it('VID: Nummer und Gruppe; Alarm: Ablammung mit Tagen', () => {
    expect(vidText(entry(), 'gruppe', today)).toBe('101 Ablammgruppe')
    expect(alertText(entry(), 'gruppe', today)).toBe('Abl 12.03.26 245 T')
  })
  it('lange Namen werden auf 20 Zeichen gekürzt, ohne Gruppe nur die Nummer', () => {
    expect(vidText(entry({ group: 'Schlachten 2.11.26 Sonder' }), 'gruppe', today)).toBe('101 Schlachten 2.11.')
    expect(vidText(entry({ group: null }), 'gruppe', today)).toBe('101')
  })
  it('ohne Laufnummer die kurze Ohrmarke', () => {
    expect(vidText(entry({ laufNr: null }), 'gruppe', today)).toMatch(/^9000\.0010 /)
  })
  it('ohne Ablammung kein Alarm', () => {
    expect(alertText(entry({ facts: { lastBirth: null, pregnancy: null } }), 'gruppe', today)).toBe('')
    expect(alertText(entry({ facts: null }), 'gruppe', today)).toBe('')
  })
})

describe('Trächtigkeitsuntersuchung', () => {
  it('VID: Nummer, Ablammung und Tage; Alarm: letzte Untersuchung', () => {
    expect(vidText(entry(), 'traechtigkeit', today)).toBe('101 Abl 12.03. 245T')
    expect(alertText(entry(), 'traechtigkeit', today)).toBe('US 10.10. ja 33T')
  })
  it('Ergebnisse: leer und unsicher', () => {
    const e = (result: 'nein' | 'unsicher') => entry({ facts: { lastBirth: '2026-03-12', pregnancy: { date: '2026-10-10', result } } })
    expect(alertText(e('nein'), 'traechtigkeit', today)).toBe('US 10.10. leer 33T')
    expect(alertText(e('unsicher'), 'traechtigkeit', today)).toBe('US 10.10. ? 33T')
  })
  it('keine Untersuchung seit der Ablammung', () => {
    expect(alertText(entry({ facts: { lastBirth: '2026-03-12', pregnancy: null } }), 'traechtigkeit', today)).toBe('keine US seit Abl.')
  })
  it('alle Texte höchstens 20 Zeichen', () => {
    const long = entry({ laufNr: '12345678', facts: { lastBirth: '2020-01-01', pregnancy: { date: '2020-02-02', result: 'nein' } } })
    for (const v of ['gruppe', 'traechtigkeit'] as const) {
      expect(vidText(long, v, today).length).toBeLessThanOrEqual(20)
      expect(alertText(long, v, today).length).toBeLessThanOrEqual(20)
    }
  })
})

describe('buildReaderLists', () => {
  it('Link-Liste mit 15-stelliger Nummer, Alarm-Nummer und Dateikopf wie AgriLink', () => {
    const out = buildReaderLists([entry()], 'gruppe', today)
    const lines = out.linkList.split('\r\n')
    expect(lines[0]).toBe('[FileType]')
    expect(lines[1]).toBe('FileType=AgriLink Linklist File, File Version 1.00')
    expect(lines).toContain('[LinkList]')
    expect(lines).toContain('756000090000010,101 Ablammgruppe,1')
    const alerts = out.alertList.split('\r\n')
    expect(alerts[1]).toBe('FileType=AgriLink Alertlist File, File Version 1.00')
    expect(alerts).toContain('[AlertList]')
    expect(alerts).toContain('1,Abl 12.03.26 245 T')
  })

  it('gleicher Alarmtext teilt sich eine Nummer, Tiere ohne Alarm bekommen 0', () => {
    const a = entry()
    const b = entry({ earTag: 'CH113900000114', laufNr: '102' })
    const c = entry({ earTag: 'CH113900000125', laufNr: '103', facts: null })
    const out = buildReaderLists([a, b, c], 'gruppe', today)
    expect(out.stats).toEqual({ animals: 3, withAlert: 2, noTag: 0, alertOverflow: 0, alerts: 1 })
    expect(out.linkList).toContain('756000090000011,102 Ablammgruppe,1')
    expect(out.linkList).toContain('756000090000012,103 Ablammgruppe,0')
  })

  it('Tiere ohne verwertbare Ohrmarke fehlen in der Liste', () => {
    const out = buildReaderLists([entry({ earTag: 'FR0099' })], 'gruppe', today)
    expect(out.stats.noTag).toBe(1)
    expect(out.linkList).not.toContain('FR0099')
  })

  it('mehr als 250 verschiedene Alarmtexte: der Rest bleibt ohne Alarm', () => {
    const many = Array.from({ length: MAX_ALERTS + 3 }, (_, i) =>
      entry({ earTag: `CH1139${String(i + 1).padStart(7, "0")}1`, laufNr: String(i), facts: { lastBirth: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), pregnancy: null } }),
    )
    const out = buildReaderLists(many, 'gruppe', today)
    expect(out.stats.alerts).toBe(MAX_ALERTS)
    expect(out.stats.alertOverflow).toBe(3)
    expect(out.linkList.split('\r\n').filter((l) => l.endsWith(',0')).length).toBe(3)
  })
})
