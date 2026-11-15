// Listen fürs Lesegerät: nach dem Lesen einer Ohrmarke zeigt der APR600 die sichtbare Nummer (VID) und einen
// Alarmtext zum Tier. Beide sind je 20 Zeichen lang; daraus entsteht eine Zeile Stand je Tier. AgriLink lädt die
// zwei Dateien (Link-Liste .alLink, Alarmliste .alAlert) aufs Gerät. Dateiformat aus AgriLink.exe abgelesen
// (CLinkList, CAlertList, CTag); AgriLink prüft sie beim Laden.
//
// Auf dem Gerät liegt nur eine Link-Liste: je nach Aufgabe die passende Variante laden.
// Die VID ist in beiden Varianten gleich: «101 (2511) 245d 1L» = Laufnummer, Ende der Ohrmarke (UID), Tage in
// Laktation (Tage seit der letzten Geburt; trockengestellte Tiere «trocken»), Anzahl saugende Lämmer.
//   gruppe:        Alarm «Abl 12.03. Ablammgrup»  (letzte Ablammung und Gruppe)       (Gruppenwechsel)
//   traechtigkeit: Alarm «Bel 20.09. US ja 31T»   (Belegung und letzte Untersuchung)  (Trächtigkeitsuntersuchung)

import type { ReaderFacts } from '@fmis/core/animals'
import { earTagToReaderIso } from '@fmis/core/tagReader'
import { shortEarTag } from '@fmis/core/earTag'

export type ListVariant = 'gruppe' | 'traechtigkeit'

export const VARIANTS: { key: ListVariant; label: string; example: string }[] = [
  { key: 'gruppe', label: 'Gruppenwechsel', example: 'Alarm: letzte Ablammung und Gruppe' },
  { key: 'traechtigkeit', label: 'Trächtigkeitsuntersuchung', example: 'Alarm: Belegung und letzte Untersuchung' },
]

export interface ReaderEntry {
  earTag: string
  laufNr: string | null
  /** Name der heutigen Tiergruppe */
  group: string | null
  /** trockengestellt: statt der Laktationstage steht «trocken» */
  dry?: boolean
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
const clip = (s: string) => deviceText(s).slice(0, MAX_TEXT).trimEnd()

const RESULT: Record<string, string> = { ja: 'ja', nein: 'leer', unsicher: '?' }

/** Nummer, die am Gerät erscheint: Laufnummer, sonst die kurze Ohrmarke. */
const nameOf = (e: ReaderEntry) => e.laufNr || shortEarTag(e.earTag)

/** Tage in Laktation: «245d» (Tage seit der letzten Geburt), «trocken» bei trockengestellten Tieren, sonst nichts. */
export function lactationText(e: ReaderEntry, today: string): string {
  if (e.dry) return 'trocken'
  const b = e.facts?.lastBirth
  return b ? `${days(b, today)}d` : ''
}

/** Ende der Ohrmarke (UID): die letzten vier Ziffern. */
const uidOf = (earTag: string) => earTag.replace(/\D/g, '').slice(-4)

/** VID: «101 (2511) 245d 1L» — Laufnummer, UID, Tage in Laktation, Anzahl saugende Lämmer. Ohne Laufnummer die kurze Ohrmarke. */
export function vidText(e: ReaderEntry, _variant: ListVariant, today: string): string {
  const n = e.facts?.nursing ?? 0
  return clip([nameOf(e), uidOf(e.earTag) ? `(${uidOf(e.earTag)})` : '', lactationText(e, today), n > 0 ? `${n}L` : ''].filter(Boolean).join(' '))
}

/** Alarmtext (leer = kein Alarm). */
export function alertText(e: ReaderEntry, variant: ListVariant, today: string): string {
  const f = e.facts
  if (variant === 'gruppe') return clip(`${f?.lastBirth ? `Abl ${ddmm(f.lastBirth)}` : ''} ${e.group ?? ''}`)
  if (!f?.lastBirth) return ''
  const bel = f.lastService ? `Bel ${ddmm(f.lastService)}` : ''
  if (!f.pregnancy) return f.lastService ? clip(`${bel} ${days(f.lastService, today)}T US?`) : 'keine US seit Abl.'
  // mit Belegung ohne Datum der Untersuchung (20 Zeichen), sonst mit Datum
  const us = bel ? `US ${RESULT[f.pregnancy.result]}` : `US ${ddmm(f.pregnancy.date)} ${RESULT[f.pregnancy.result]}`
  return clip(`${bel} ${us} ${days(f.pregnancy.date, today)}T`)
}

/** Ein Link-Listen-Eintrag in der Form für den Server (components/ReaderListsDialog.tsx: «aufs Gerät senden»). */
export interface DeviceRow {
  iso: string
  vid: string
  alert: number
}

export interface ReaderLists {
  linkList: string
  alertList: string
  /** dieselben Einträge wie die Link-Liste, für das direkte Senden */
  rows: DeviceRow[]
  stats: { animals: number; withAlert: number; noTag: number; alertOverflow: number; alerts: number }
}

const header = (type: string) =>
  ['[FileType]', `FileType=AgriLink ${type} File, File Version 1.00`, 'Date=', 'Generator=FMIS', 'GeneratorVersion=1', ''].join('\r\n')

export function buildReaderLists(entries: ReaderEntry[], variant: ListVariant, today: string): ReaderLists {
  const alerts = new Map<string, number>()
  const links: string[] = []
  const rows: DeviceRow[] = []
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
    const vid = vidText(e, variant, today)
    links.push(`${iso},${vid},${id}`)
    rows.push({ iso, vid, alert: id })
  }
  stats.alerts = alerts.size
  return {
    linkList: [header('Linklist'), '[LinkList]', ...links, ''].join('\r\n'),
    alertList: [header('Alertlist'), '[AlertList]', ...[...alerts].map(([text, id]) => `${id},${text}`), ''].join('\r\n'),
    rows,
    stats,
  }
}
