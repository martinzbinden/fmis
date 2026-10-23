import type { JournalCategory } from '../types'
import { addDays } from './format'

export const JOURNAL_CATEGORIES: { key: JournalCategory; label: string; icon: string }[] = [
  { key: 'beobachtung', label: 'Beobachtung', icon: '👁️' },
  { key: 'krankheit', label: 'Krankheit', icon: '🤒' },
  { key: 'behandlung', label: 'Behandlung', icon: '💉' },
  { key: 'brunst', label: 'Brunst', icon: '❤️' },
  { key: 'klauen', label: 'Klauen', icon: '🦶' },
  { key: 'trocken', label: 'Trockengestellt', icon: '⏸️' },
  { key: 'notiz', label: 'Notiz', icon: '📝' },
]

export function categoryLabel(c: JournalCategory | null): string {
  return JOURNAL_CATEGORIES.find((x) => x.key === (c ?? 'notiz'))?.label ?? 'Notiz'
}

export function categoryIcon(c: JournalCategory | null): string {
  return JOURNAL_CATEGORIES.find((x) => x.key === (c ?? 'notiz'))?.icon ?? '📝'
}

/** Letzter Tag der Absetzfrist (Behandlungstag + Frist); null ohne Frist. */
export function withdrawalEnd(entryDate: string, days: number | null): string | null {
  return days != null && days > 0 ? addDays(entryDate, days) : null
}

/** Kurztext, wenn bei einer Behandlung/Krankheit keine eigene Bemerkung
 * erfasst wurde — `text` ist Pflicht und erscheint in Listen. */
export function journalSummary(e: {
  category: JournalCategory | null
  diagnosis: string | null
  medication: string | null
  dose: string | null
}): string {
  const parts = [e.diagnosis, [e.medication, e.dose].filter(Boolean).join(' ')].filter(Boolean)
  return parts.length ? parts.join(' – ') : categoryLabel(e.category)
}

// --- Journal nur ergänzend führen (schema/0014) ------------------------------

/** SQL-Bedingung: Eintrag `alias` wurde nicht durch einen neueren korrigiert.
 * Für alles, was gilt (offene Absetzfristen, Warnungen): ein korrigierter
 * Eintrag zählt nicht mehr, die Korrektur schon. */
export const notSupersededSql = (alias: string) =>
  `not exists (select 1 from animal_journal c where c.corrects_id = ${alias}.id and c.deleted_at is null)`

type Linked = { id: string; corrects_id: string | null; deleted_at?: string | null }

/** ids der Einträge, die inzwischen korrigiert wurden → id der Korrektur (die jüngste, falls mehrere). */
export function supersededBy<T extends Linked & { entry_date: string; updated_at?: string }>(entries: T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const e of entries) {
    if (e.deleted_at || !e.corrects_id) continue
    const prev = out.get(e.corrects_id)
    if (!prev || e.entry_date > prev.entry_date || (e.entry_date === prev.entry_date && (e.updated_at ?? '') > (prev.updated_at ?? ''))) out.set(e.corrects_id, e)
  }
  return out
}

export interface JournalCase<T> {
  /** case_id, bei Einträgen ohne Fall die eigene id */
  key: string
  /** true, wenn die Einträge einen Fall bilden (case_id vorhanden; auch mit nur einem Eintrag, damit sich Folgeeinträge anhängen lassen) */
  isCase: boolean
  /** aufsteigend: ältester Eintrag zuerst */
  entries: T[]
  startDate: string
  lastDate: string
}

/** Einträge je Tier und Fall gruppieren: gleiche case_id = ein Fall mit
 * Verlauf (Befund, Folgebehandlungen, Beobachtungen); Einträge ohne case_id
 * bleiben einzeln. Neueste Aktivität zuerst. Mehrere Tiere nie vermischen. */
export function groupCases<T extends Linked & { entry_date: string; treatment_time?: string | null; animal_id?: string | null; case_id: string | null; updated_at?: unknown }>(entries: T[]): JournalCase<T>[] {
  const map = new Map<string, T[]>()
  for (const e of entries) {
    const key = e.case_id ? `${e.animal_id ?? ''}|${e.case_id}` : e.id
    map.set(key, [...(map.get(key) ?? []), e])
  }
  const cases = [...map.entries()].map(([key, list]) => {
    const ts = (v: unknown) => (v ? new Date(v as string).getTime() : 0)
    // gleicher Tag und gleiche Uhrzeit: in der Reihenfolge der Erfassung
    const sorted = [...list].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || (a.treatment_time ?? '').localeCompare(b.treatment_time ?? '') || ts(a.updated_at) - ts(b.updated_at))
    return {
      key,
      isCase: !!sorted[0].case_id,
      entries: sorted,
      startDate: sorted[0].entry_date,
      lastDate: sorted[sorted.length - 1].entry_date,
    }
  })
  return cases.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.startDate.localeCompare(a.startDate))
}

/** Korrekturfrist (wie auf dem Server, sync_push.py): Wer das Recht
 * «core:korrektur:write» nicht hat, ändert oder löscht einen Eintrag nur
 * innerhalb dieser Minuten. Danach bleibt «Korrigieren» (neuer Eintrag). */
export const CORRECTION_WINDOW_MIN = 10

export function canChangeEntry(entry: { updated_at: string; source: string }, hasCorrectionRight: boolean, now = Date.now()): boolean {
  if (entry.source !== 'manual') return false
  if (hasCorrectionRight) return true
  const t = new Date(entry.updated_at).getTime() // string oder Date (pglite)
  return Number.isFinite(t) && now - t <= CORRECTION_WINDOW_MIN * 60_000
}
