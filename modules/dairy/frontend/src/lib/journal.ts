import type { JournalCategory } from '../types'
import { addDays } from './format'

export const JOURNAL_CATEGORIES: { key: JournalCategory; label: string; icon: string }[] = [
  { key: 'beobachtung', label: 'Beobachtung', icon: '👁️' },
  { key: 'krankheit', label: 'Krankheit', icon: '🤒' },
  { key: 'behandlung', label: 'Behandlung', icon: '💉' },
  { key: 'brunst', label: 'Brunst', icon: '❤️' },
  { key: 'klauen', label: 'Klauen', icon: '🦶' },
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
