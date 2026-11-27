// Arbeitsplan-Ansicht (pages/WorkPlan.tsx): reine Hilfen zum Aufteilen und Nachladen, getestet in workPlanView.test.ts.

import { addDaysIso } from './format'

/** Geplante Parzellen-Arbeiten, die länger als `days` Tage überfällig sind, kommen in einen eigenen Block
 * «Überfällig»; die übrigen bleiben in der Tagesauswahl. */
export function splitOverdue<T extends { date: string }>(tasks: T[], today: string, days = 14): { current: T[]; overdue: T[] } {
  const cutoff = addDaysIso(today, -days)
  const current: T[] = []
  const overdue: T[] = []
  for (const t of tasks) (t.date < cutoff ? overdue : current).push(t)
  return { current, overdue }
}

/** Betriebsjournal: so viele Tage zurück wird gezeigt; «ältere laden» erweitert um je JOURNAL_STEP_DAYS. */
export const JOURNAL_STEP_DAYS = 90

/** Gibt es vor `since` noch Einträge? */
export const hasOlderJournal = (oldest: string | null, since: string) => oldest != null && oldest < since
