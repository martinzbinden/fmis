// «Rückgängig» für alles, was in dieser Sitzung eingegeben oder geändert wurde.
//
// Jedes Modul schreibt über seine db/write.ts (upsertRow & Co.). Die meldet nach
// dem Commit jede geschriebene Zeile mit ihrem Stand DAVOR hierher, zusammen mit
// einer Funktion, die diese Stände über denselben Schreibweg (Outbox, Verlauf,
// Sync) wiederherstellt. Was kurz hintereinander im selben Modul geschrieben
// wird (eine Speichern-Aktion = oft mehrere Zeilen), wird ein Schritt.
//
// Nur im Speicher: Nach dem Neuladen der App ist die Sitzung vorbei — ältere
// Änderungen kann nur ein Admin über das Protokoll (📜) zurücknehmen
// (HistoryUndoButton.tsx).

import { useSyncExternalStore } from 'react'

export type UndoKind = 'insert' | 'update' | 'delete'

export interface UndoChange {
  table: string
  id: string
  kind: UndoKind
  /** Zeile vor der Änderung; null = war neu */
  before: Record<string, unknown> | null
}

/** Stellt die Stände wieder her — bekommt die Änderungen in umgekehrter
 * Reihenfolge (zuletzt geschriebene zuerst), damit bei mehrfach geänderten
 * Zeilen am Ende der älteste Stand steht. */
export type UndoRestore = (changes: UndoChange[]) => Promise<void>

export interface UndoStep {
  id: number
  /** Modul-Instanz, z.B. "dairy_schafe" */
  source: string
  at: number
  lastAt: number
  changes: UndoChange[]
  restore: UndoRestore
  undone: boolean
}

/** Schreibungen innert dieser Frist zählen zur selben Aktion. */
const GROUP_MS = 1500
const MAX_STEPS = 50

let steps: UndoStep[] = []
let nextId = 1
let suppressed = 0
const listeners = new Set<() => void>()

function emit() {
  steps = [...steps]
  listeners.forEach((l) => l())
}

export function subscribeUndo(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getUndoSteps(): UndoStep[] {
  return steps
}

export function useUndoSteps(): UndoStep[] {
  return useSyncExternalStore(subscribeUndo, getUndoSteps)
}

/** Von den write.ts der Module nach jedem erfolgreichen Schreiben aufgerufen. */
export function recordUndo(source: string, restore: UndoRestore, changes: UndoChange[], now = Date.now()): void {
  if (suppressed > 0 || changes.length === 0) return
  const last = steps[steps.length - 1]
  if (last && !last.undone && last.source === source && now - last.lastAt < GROUP_MS) {
    last.changes = [...last.changes, ...changes]
    last.lastAt = now
  } else {
    steps.push({ id: nextId++, source, at: now, lastAt: now, changes: [...changes], restore, undone: false })
    if (steps.length > MAX_STEPS) steps = steps.slice(-MAX_STEPS)
  }
  emit()
}

/** Nimmt einen Schritt zurück. Das Zurücknehmen selbst wird nicht wieder als
 * Schritt erfasst (es steht aber im Verlauf). */
export async function undoStep(id: number): Promise<void> {
  const step = steps.find((s) => s.id === id)
  if (!step || step.undone) return
  suppressed++
  try {
    await step.restore([...step.changes].reverse())
  } finally {
    suppressed--
  }
  step.undone = true
  emit()
}

/** Nur für Tests. */
export function resetUndo(): void {
  steps = []
  nextId = 1
  suppressed = 0
}

/** Bereichsnamen für «Rückgängig» und den Verlauf (Tabellen aller Module). */
export const TABLE_LABELS: Record<string, string> = {
  // Milchschafe / Milchkühe
  animals: 'Tier', milk_tests: 'Milchwägung', lactations: 'Laktation', milking_banks: 'Melkbank', milking_slots: 'Melkplatz',
  animal_journal: 'Journal', treatment_templates: 'Behandlungsvorlage', pedigree: 'Abstammung', matings: 'Belegung',
  pregnancy_checks: 'Trächtigkeit', births: 'Geburt', birth_offspring: 'Nachkomme', watchlists: 'Merkliste',
  watchlist_entries: 'Merkliste', claw_exams: 'Klauen', claw_findings: 'Klauenbefund', lamb_selection: 'Lämmer-Selektion',
  breeding_values: 'Zuchtwert', conformation_scores: 'Exterieur',
  // Tiere
  locations: 'Ort', herd_groups: 'Gruppe', herd_stays: 'Aufenthalt', herd_members: 'Gruppenzuteilung', herd_counts: 'Tierzahl', herd_laufhof: 'Laufhof',
  // Bau
  projects: 'Projekt', variants: 'Variante', features: 'Element', survey_points: 'Messpunkt', overlays: 'Plan',
  // Betrieb
  machines: 'Maschine', machine_files: 'Maschinendatei', maintenance_tasks: 'Wartung', maintenance_log: 'Wartungsjournal', machine_todos: 'Maschinen-Pendenz',
  tracks: 'Spur', tank_events: 'Tanken', duty_people: 'Person', duty_types: 'Dienst', duty_absences: 'Abwesenheit', duty_shifts: 'Dienstplan',
  duty_templates: 'Dienstvorlage', duty_weeks: 'Dienstwoche', work_assignments: 'Arbeitsauftrag', duty_requests: 'Wunsch', duty_changes: 'Diensttausch',
  // Wiesenjournal
  parcels: 'Parzelle', paddocks: 'Weide', usage_entries: 'Nutzung', fertilizer_types: 'Dünger', fertilization_entries: 'Düngung',
  daily_farm_log: 'Tagesmeldung', weed_observations: 'Unkraut', sowing_details: 'Saat',
  // Mast
  animal_groups: 'Gruppe', group_memberships: 'Gruppenzuteilung', weighings: 'Wägung', medications: 'Behandlung', feed_records: 'Futter',
  expenses: 'Ausgabe', slaughter_results: 'Schlachtung', market_prices: 'Marktpreis',
  // Felder
  farms: 'Betrieb', management_units: 'Bewirtschaftungseinheit', field_declarations: 'Flächenangabe', plan_layers: 'Planebene', plan_parcels: 'Planparzelle',
}

const KIND_WORD: Record<UndoKind, string> = { insert: 'neu', update: 'geändert', delete: 'gelöscht' }

/** Kurzbeschreibung eines Schritts, z.B. «15 Einträge neu, 1 geändert». Jede Zeile
 * zählt einmal (mit ihrer ersten Änderung im Schritt). */
export function describeStep(step: Pick<UndoStep, 'changes'>): string {
  const first = new Map<string, UndoChange>()
  for (const c of step.changes) {
    const key = `${c.table}|${c.id}`
    if (!first.has(key)) first.set(key, c)
    // gelöscht schlägt alles: neu angelegt und wieder gelöscht ist «gelöscht»
    else if (c.kind === 'delete') first.set(key, { ...first.get(key)!, kind: 'delete' })
  }
  const count: Record<UndoKind, number> = { insert: 0, update: 0, delete: 0 }
  for (const c of first.values()) count[c.kind]++
  const kinds = (Object.keys(count) as UndoKind[]).filter((k) => count[k] > 0)
  const areas = [...new Set([...first.values()].map((c) => TABLE_LABELS[c.table] ?? c.table))]
  const area = areas.length === 1 ? `${areas[0]}: ` : areas.length === 2 ? `${areas.join(' + ')}: ` : ''
  const total = first.size
  if (kinds.length === 1) return `${area}${total} ${KIND_WORD[kinds[0]]}`
  return `${area}${kinds.map((k) => `${count[k]} ${KIND_WORD[k]}`).join(', ')}`
}
