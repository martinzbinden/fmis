// Verlauf einer Gruppe und «Rückgängig» pro Schritt. Quelle ist das Änderungsprotokoll des Servers
// (data_history): jede Änderung steht dort als Zeile mit dem Stand danach. Ein «Schritt» ist, was eine
// Person kurz hintereinander geschrieben hat (eine Aktion der App schreibt in einem Zug).

import { undoPlan } from '@fmis/core/HistoryUndoButton'
import type { HistoryEntry } from '@fmis/core/historyApi'

/** Zwischen zwei Einträgen eines Schritts liegt höchstens so viel Zeit. */
export const STEP_GAP_MS = 10_000

const time = (e: HistoryEntry) => Date.parse(e.changed_at)

function snap(e: HistoryEntry): Record<string, unknown> {
  try {
    return JSON.parse(e.snapshot) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Zu welcher Gruppe gehört der Eintrag? (Gruppe selbst, Mitglied, Stall/Weide, Anzahl, Laufhof) */
export function entryGroupId(e: HistoryEntry): string | null {
  if (e.table_name === 'herd_groups') return e.row_id
  if (['herd_members', 'herd_stays', 'herd_counts', 'herd_laufhof'].includes(e.table_name)) {
    const g = snap(e).group_id
    return typeof g === 'string' ? g : null
  }
  return null
}

export interface Step {
  /** neuester Eintrag zuerst */
  entries: HistoryEntry[]
  by: string | null
  /** Zeit des neuesten Eintrags */
  at: string
}

/** Einträge zu Schritten bündeln: gleiche Person, höchstens STEP_GAP_MS Abstand. Neueste Schritte zuerst. */
export function buildSteps(entries: HistoryEntry[], gapMs = STEP_GAP_MS): Step[] {
  const sorted = [...entries].filter((e) => e.table_name !== 'data_history').sort((a, b) => time(b) - time(a) || b.id.localeCompare(a.id))
  const steps: Step[] = []
  for (const e of sorted) {
    const last = steps[steps.length - 1]
    const lastOldest = last ? last.entries[last.entries.length - 1] : null
    if (last && lastOldest && last.by === e.changed_by && time(lastOldest) - time(e) <= gapMs) last.entries.push(e)
    else steps.push({ entries: [e], by: e.changed_by, at: e.changed_at })
  }
  return steps
}

/** Schritte, die diese Gruppe betreffen. */
export const stepsOfGroup = (steps: Step[], groupId: string): Step[] => steps.filter((s) => s.entries.some((e) => entryGroupId(e) === groupId))

export interface StepSummary {
  /** z.B. «5 Tiere zugeteilt, 2 entfernt, Stall geändert» */
  title: string
  /** weitere Gruppen, die der Schritt ebenfalls betraf */
  others: string[]
  rows: number
}

export function describeStep(step: Step, groupId: string, nameOf: (id: string) => string): StepSummary {
  const mine = step.entries.filter((e) => entryGroupId(e) === groupId)
  const members = mine.filter((e) => e.table_name === 'herd_members')
  const joined = members.filter((e) => e.action === 'insert').length
  const left = members.filter((e) => e.action === 'delete' || (e.action === 'update' && snap(e).to_date != null)).length
  const parts: string[] = []
  const grp = mine.find((e) => e.table_name === 'herd_groups')
  const groupPart = grp ? (grp.action === 'insert' ? 'Gruppe angelegt' : snap(grp).active === false ? 'Gruppe aufgelöst' : 'Gruppe geändert') : null
  // «Gruppe geändert» schreiben viele Aktionen nebenbei (Gruppe wird mitgespeichert): nur nennen, wenn sonst nichts war
  if (groupPart && (groupPart !== 'Gruppe geändert' || (!joined && !left))) parts.push(groupPart)
  if (joined) parts.push(`${joined} ${joined === 1 ? 'Tier' : 'Tiere'} zugeteilt`)
  if (left) parts.push(`${left} ${left === 1 ? 'Tier' : 'Tiere'} entfernt`)
  const stays = mine.filter((e) => e.table_name === 'herd_stays')
  if (stays.length) parts.push([...new Set(stays.map((e) => (snap(e).slot === 'weide' ? 'Weide' : 'Stall')))].join(' und ') + ' geändert')
  if (mine.some((e) => e.table_name === 'herd_counts')) parts.push('Anzahl ohne Nummer geändert')
  if (mine.some((e) => e.table_name === 'herd_laufhof')) parts.push('Laufhof')
  const others = [...new Set(step.entries.map(entryGroupId).filter((id): id is string => !!id && id !== groupId))].map(nameOf)
  return { title: parts.join(', ') || 'Änderung', others, rows: new Set(step.entries.map((e) => `${e.table_name}:${e.row_id}`)).size }
}

export interface UndoRow {
  table_name: string
  row_id: string
  /** Stand davor; null = Zeile löschen */
  state: Record<string, unknown> | null
  /** Änderungen an dieser Zeile NACH dem Schritt (gehen beim Zurücknehmen verloren) */
  later: number
}

/** Was «Rückgängig» für den Schritt tut: je Zeile zurück auf den Stand vor der ersten Änderung des Schritts.
 * `missing` = Zeilen, deren früherer Stand nicht im geladenen Verlauf steht (einzeln nachladen). */
export function planStepUndo(step: Step, all: HistoryEntry[]): { rows: UndoRow[]; missing: { table_name: string; row_id: string }[] } {
  const byRow = new Map<string, HistoryEntry[]>()
  for (const e of step.entries) byRow.set(`${e.table_name}:${e.row_id}`, [...(byRow.get(`${e.table_name}:${e.row_id}`) ?? []), e])
  const inStep = new Set(step.entries.map((e) => e.id))
  const rows: UndoRow[] = []
  const missing: { table_name: string; row_id: string }[] = []
  for (const list of byRow.values()) {
    const first = [...list].sort((a, b) => time(a) - time(b))[0]
    const newestInStep = Math.max(...list.map(time))
    // je Eintrag einmal: sonst gälte ein doppelt geladener Eintrag als sein eigener Vorgänger
    const history = [...new Map(all.filter((e) => e.table_name === first.table_name && e.row_id === first.row_id).map((e) => [e.id, e])).values()]
    const plan = undoPlan(first, history)
    if ('error' in plan) {
      missing.push({ table_name: first.table_name, row_id: first.row_id })
      continue
    }
    rows.push({
      table_name: first.table_name,
      row_id: first.row_id,
      state: plan.state,
      later: history.filter((e) => !inStep.has(e.id) && time(e) > newestInStep).length,
    })
  }
  return { rows, missing }
}
