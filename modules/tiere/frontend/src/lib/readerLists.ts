// Listen fürs Lesegerät: nach dem Lesen einer Ohrmarke zeigt der APR600 die sichtbare Nummer (VID) und einen
// Alarmtext zum Tier. Beide sind je 20 Zeichen lang; daraus entsteht eine Zeile Stand je Tier. AgriLink lädt die
// zwei Dateien (Link-Liste .alLink, Alarmliste .alAlert) aufs Gerät. Dateiformat aus AgriLink.exe abgelesen
// (CLinkList, CAlertList, CTag); AgriLink prüft sie beim Laden.
//
// Auf dem Gerät liegt nur eine Link-Liste: je nach Aufgabe die passende Variante laden.
//   gruppe:        VID «Nummer Gruppe», Alarm «Abl 12.03.26 240 T»       (Gruppenwechsel)
//   traechtigkeit: VID «Nummer Abl 12.03. 240T», Alarm «US 10.10. ja 31T» (Trächtigkeitsuntersuchung)

import type { ReaderFacts } from '@fmis/core/animals'
import { earTagToReaderIso } from '@fmis/core/tagReader'
import { shortEarTag } from '@fmis/core/earTag'

export type ListVariant = 'gruppe' | 'traechtigkeit'

export const VARIANTS: { key: ListVariant; label: string; example: string }[] = [
  { key: 'gruppe', label: 'Gruppenwechsel', example: 'Nummer und Gruppe; Alarm: letzte Ablammung' },
  { key: 'traechtigkeit', label: 'Trächtigkeitsuntersuchung', example: 'Nummer und Ablammung; Alarm: letzte Untersuchung' },
]

export interface ReaderEntry {
  earTag: string
  laufNr: string | null
  /** Name der heutigen Tiergruppe */
  group: string | null
  facts: ReaderFacts | null
}

const MAX_TEXT = 20
/** Alarmnummern 0 bis 250 am Gerät; 0 = kein Alarm */
export const MAX_ALERTS = 250

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', é: 'e', è: 'e', à: 'a', ç: 'c', ',': ' ', ';': ' ' }

/** Text fürs Gerät: nur ASCII (Umlaute ausgeschrieben), keine Kommas, Leerraum zusammengefasst. */
export function deviceText(text: string): string {
  const out = [...text].map((c) => TRANSLIT[c] ?? (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c : '?')).join('')
  return out.split(/\s+/).filter(Boolean).join(' ')
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000)
const days = (from: string, today: string) => dayNumber(today) - dayNumber(from)
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
const ddmmyy = (iso: string) => `${ddmm(iso)}${iso.slice(2, 4)}`
const clip = (s: string) => deviceText(s).slice(0, MAX_TEXT).trimEnd()

const RESULT: Record<string, string> = { ja: 'ja', nein: 'leer', unsicher: '?' }

/** Nummer, die am Gerät erscheint: Laufnummer, sonst die kurze Ohrmarke. */
const nameOf = (e: ReaderEntry) => e.laufNr || shortEarTag(e.earTag)

export function vidText(e: ReaderEntry, variant: ListVariant, today: string): string {
  if (variant === 'gruppe') return clip(`${nameOf(e)} ${e.group ?? ''}`)
  const b = e.facts?.lastBirth
  return clip(b ? `${nameOf(e)} Abl ${ddmm(b)} ${days(b, today)}T` : nameOf(e))
}

/** Alarmtext (leer = kein Alarm). */
export function alertText(e: ReaderEntry, variant: ListVariant, today: string): string {
  const f = e.facts
  if (!f?.lastBirth) return ''
  if (variant === 'gruppe') return clip(`Abl ${ddmmyy(f.lastBirth)} ${days(f.lastBirth, today)} T`)
  if (!f.pregnancy) return 'keine US seit Abl.'
  return clip(`US ${ddmm(f.pregnancy.date)} ${RESULT[f.pregnancy.result]} ${days(f.pregnancy.date, today)}T`)
}

export interface ReaderLists {
  linkList: string
  alertList: string
  stats: { animals: number; withAlert: number; noTag: number; alertOverflow: number; alerts: number }
}

const header = (type: string) =>
  ['[FileType]', `FileType=AgriLink ${type} File, File Version 1.00`, 'Date=', 'Generator=FMIS', 'GeneratorVersion=1', ''].join('\r\n')

export function buildReaderLists(entries: ReaderEntry[], variant: ListVariant, today: string): ReaderLists {
  const alerts = new Map<string, number>()
  const links: string[] = []
  const stats = { animals: 0, withAlert: 0, noTag: 0, alertOverflow: 0, alerts: 0 }
  for (const e of entries) {
    const iso = earTagToReaderIso(e.earTag)
    if (!iso) {
      stats.noTag++
      continue
    }
    let id = 0
    const text = alertText(e, variant, today)
    if (text) {
      id = alerts.get(text) ?? 0
      if (!id) {
        if (alerts.size >= MAX_ALERTS) stats.alertOverflow++
        else {
          id = alerts.size + 1
          alerts.set(text, id)
        }
      }
      if (id) stats.withAlert++
    }
    stats.animals++
    links.push(`${iso},${vidText(e, variant, today)},${id}`)
  }
  stats.alerts = alerts.size
  return {
    linkList: [header('Linklist'), '[LinkList]', ...links, ''].join('\r\n'),
    alertList: [header('Alertlist'), '[AlertList]', ...[...alerts].map(([text, id]) => `${id},${text}`), ''].join('\r\n'),
    stats,
  }
}
