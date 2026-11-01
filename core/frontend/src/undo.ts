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

import { useEffect, useRef, useSyncExternalStore } from 'react'

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

/** Ein Modul-Anteil eines Schritts mit seiner eigenen Wiederherstellung. */
export interface UndoPart {
  source: string
  restore: UndoRestore
  changes: UndoChange[]
}

export interface UndoStep {
  id: number
  /** Modul-Instanz, z.B. "dairy_schafe" (bei mehreren: die erste) */
  source: string
  at: number
  lastAt: number
  /** alle Änderungen des Schritts (für die Beschreibung) */
  changes: UndoChange[]
  parts: UndoPart[]
  /** Text aus Nutzersicht, z.B. «Ablammung Berta, 1 Lamm» (undoAction) */
  label?: string
  undone: boolean
}

/** Schreibungen innert dieser Frist zählen zur selben Aktion. */
const GROUP_MS = 1500
const MAX_STEPS = 50

let steps: UndoStep[] = []
let nextId = 1
let suppressed = 0
/** Laufende undoAction: alles darin wird EIN Schritt, unabhängig von der Uhr */
let action: { label?: string; stepId: number | null; depth: number } | null = null
const listeners = new Set<() => void>()
const undoListeners = new Set<(step: UndoStep) => void>()

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

/** Meldet, wenn ein Schritt zurückgenommen wurde — z.B. um «Gespeichert» auszublenden. */
export function onUndo(listener: (step: UndoStep) => void): () => void {
  undoListeners.add(listener)
  return () => undoListeners.delete(listener)
}

/** Hook zu onUndo (die Funktion darf bei jedem Rendern neu sein). */
export function useOnUndo(listener: (step: UndoStep) => void): void {
  const ref = useRef(listener)
  ref.current = listener
  useEffect(() => onUndo((s) => ref.current(s)), [])
}

function addTo(step: UndoStep, source: string, restore: UndoRestore, changes: UndoChange[]) {
  step.changes = [...step.changes, ...changes]
  const part = step.parts.find((p) => p.source === source)
  if (part) part.changes = [...part.changes, ...changes]
  else step.parts = [...step.parts, { source, restore, changes: [...changes] }]
}

/** Von den write.ts der Module nach jedem erfolgreichen Schreiben aufgerufen. */
export function recordUndo(source: string, restore: UndoRestore, changes: UndoChange[], now = Date.now()): void {
  if (suppressed > 0 || changes.length === 0) return
  const last = steps[steps.length - 1]
  const inAction = action?.stepId != null ? steps.find((s) => s.id === action!.stepId && !s.undone) : undefined
  if (inAction) {
    addTo(inAction, source, restore, changes)
    inAction.lastAt = now
  } else if (!action && last && !last.undone && last.source === source && last.parts.length === 1 && now - last.lastAt < GROUP_MS) {
    addTo(last, source, restore, changes)
    last.lastAt = now
  } else {
    const step: UndoStep = { id: nextId++, source, at: now, lastAt: now, changes: [...changes], parts: [{ source, restore, changes: [...changes] }], label: action?.label, undone: false }
    if (action) action.stepId = step.id
    steps.push(step)
    if (steps.length > MAX_STEPS) steps = steps.slice(-MAX_STEPS)
  }
  emit()
}

/** Alles, was `fn` schreibt (auch in mehreren Modulen und über längere Zeit),
 * wird EIN Rückgängig-Schritt mit diesem Text. Verschachtelt: der äussere zählt. */
export async function undoAction<T>(label: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (action) {
    action.depth++
    try {
      return await fn()
    } finally {
      action.depth--
    }
  }
  action = { label, stepId: null, depth: 1 }
  try {
    return await fn()
  } finally {
    action = null
  }
}

/** Nimmt einen Schritt zurück. Das Zurücknehmen selbst wird nicht wieder als
 * Schritt erfasst (es steht aber im Verlauf). */
export async function undoStep(id: number): Promise<void> {
  const step = steps.find((s) => s.id === id)
  if (!step || step.undone) return
  suppressed++
  try {
    // zuletzt geschriebene Module zuerst, je Modul in umgekehrter Reihenfolge
    for (const part of [...step.parts].reverse()) await part.restore([...part.changes].reverse())
  } finally {
    suppressed--
  }
  step.undone = true
  emit()
  undoListeners.forEach((l) => l(step))
}

/** Der Server hat das Zurücknehmen abgelehnt (Korrekturfrist): Schritt gilt
 * wieder als offen. */
export function markNotUndone(id: number): void {
  const step = steps.find((s) => s.id === id)
  if (!step || !step.undone) return
  step.undone = false
  emit()
}

/** Nur für Tests. */
export function resetUndo(): void {
  steps = []
  nextId = 1
  suppressed = 0
  action = null
}

/** Bereichsnamen für «Rückgängig» und den Verlauf (Tabellen aller Module). */
export const TABLE_LABELS: Record<string, string> = {
  // Milchschafe / Milchkühe
  animals: 'Tier', milk_tests: 'Milchwägung', lactations: 'Laktation', milking_banks: 'Bank (Milchwägung)', milking_slots: 'Platz (Milchwägung)',
  animal_journal: 'Journal', treatment_templates: 'Behandlungsvorlage', pedigree: 'Abstammung', matings: 'Belegung',
  pregnancy_checks: 'Trächtigkeit', births: 'Geburt', birth_offspring: 'Nachkomme', watchlists: 'Merkliste',
  watchlist_entries: 'Merklisten-Eintrag', reminders: 'Erinnerung', claw_exams: 'Klauen', claw_findings: 'Klauenbefund', lamb_selection: 'Lämmer-Selektion',
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
export function describeStep(step: Pick<UndoStep, 'changes'> & { label?: string }): string {
  if (step.label) return step.label
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
  const area = areas.length === 1 ? `${areas[0]}: ` : areas.length === 2 ? `${areas.join(' + ')}: ` : `${areas[0]} u.a.: `
  const total = first.size
  if (kinds.length === 1) return `${area}${total} ${KIND_WORD[kinds[0]]}`
  return `${area}${kinds.map((k) => `${count[k]} ${KIND_WORD[k]}`).join(', ')}`
}
