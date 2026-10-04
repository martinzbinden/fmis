// Wartungsjournal (schema/0020) — reine Funktionen (getestet): Kategorie
// einer Maschine, Zähler (Betriebsstunden bzw. km), Fälligkeit je Aufgabe,
// Standard-Wartungspläne je Art.

import type { Machine, MachineCategory, MachineKind, MaintenanceLog, MaintenanceTask, MaintenanceTaskType } from '../types'

// --- Kategorien ---

export const CATEGORY_LABEL: Record<MachineCategory, string> = {
  zugfahrzeug: 'Zugfahrzeuge',
  anbaugeraet: 'Anbaugeräte',
  anhaenger: 'Anhänger',
  auto: 'Autos',
  uebrige: 'Übrige',
}
export const CATEGORY_ICON: Record<MachineCategory, string> = {
  zugfahrzeug: '🚜',
  anbaugeraet: '⚙️',
  anhaenger: '🛞',
  auto: '🚗',
  uebrige: '🧰',
}

/** Kategorie nach Art: Zugfahrzeuge fahren selbst (Traktor, Hoflader,
 * Motormäher), Anbaugeräte hängen an Dreipunkt/Front/Lader, Anhänger
 * (landwirtschaftliche Anhänger und Arbeitsanhänger) werden gezogen. */
export const KIND_CATEGORY: Record<MachineKind, MachineCategory> = {
  traktor: 'zugfahrzeug',
  hoflader: 'zugfahrzeug',
  motormaeher: 'zugfahrzeug',
  auto: 'auto',
  maehwerk: 'anbaugeraet',
  aufbereiter: 'anbaugeraet',
  zettwender: 'anbaugeraet',
  pflug: 'anbaugeraet',
  kreiselegge: 'anbaugeraet',
  saatkombination: 'anbaugeraet',
  saemaschine: 'anbaugeraet',
  duengerstreuer: 'anbaugeraet',
  ladergeraet: 'anbaugeraet',
  guellefass: 'anhaenger',
  miststreuer: 'anhaenger',
  ladewagen: 'anhaenger',
  viehanhaenger: 'anhaenger',
  schwader: 'anhaenger',
  verschlauchung: 'uebrige',
  andere: 'uebrige',
}

export const categoryOf = (m: Pick<Machine, 'kind' | 'category'>): MachineCategory => m.category ?? KIND_CATEGORY[m.kind] ?? 'uebrige'

/** Zähler: Autos in km, Zugfahrzeuge in Betriebsstunden (Stundenzähler),
 * Geräte in Einsatzstunden aus den GPS-Fahrten. */
export const counterUnit = (m: Pick<Machine, 'kind' | 'category'>): 'km' | 'h' => (categoryOf(m) === 'auto' ? 'km' : 'h')
/** Hat einen eigenen Zähler (abgelesen), sonst Stunden aus Fahrten. */
export const hasCounter = (m: Pick<Machine, 'kind' | 'category'>) => ['zugfahrzeug', 'auto'].includes(categoryOf(m))

// --- Zähler und Fälligkeit ---

export const parseTaskIds = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** Neuester abgelesener Zählerstand (Datum ignoriert Uhrzeit). */
export function latestCounter(log: MaintenanceLog[]): { value: number; date: string } | null {
  let best: { value: number; date: string } | null = null
  for (const l of log) {
    if (l.deleted_at || l.counter == null) continue
    if (!best || l.done_date > best.date || (l.done_date === best.date && l.counter > best.value)) best = { value: l.counter, date: l.done_date }
  }
  return best
}

export interface TrackSpan {
  started_at: string
  ended_at: string | null
}

/** Einsatzstunden aus GPS-Fahrten ab einem Tag (inklusive). */
export function trackedHoursSince(tracks: TrackSpan[], since: string | null): number {
  let ms = 0
  for (const t of tracks) {
    if (!t.ended_at) continue
    if (since && t.started_at.slice(0, 10) < since) continue
    ms += Math.max(0, Date.parse(t.ended_at) - Date.parse(t.started_at))
  }
  return ms / 3_600_000
}

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export type DueState = 'faellig' | 'bald' | 'ok' | 'offen'

export interface TaskStatus {
  task: MaintenanceTask
  last: MaintenanceLog | null
  /** fällig am (Monats-Intervall) */
  dueDate: string | null
  daysLeft: number | null
  /** verbleibend in Zählereinheit (Stunden-/km-Intervall) */
  countLeft: number | null
  /** seit der letzten Erledigung verbraucht */
  countUsed: number | null
  state: DueState
}

/** Wie bald gilt als "bald fällig": 30 Tage bzw. 10 % des Intervalls
 * (mindestens 5 h bzw. 500 km). */
export const SOON_DAYS = 30
const soonCount = (interval: number, unit: 'h' | 'km') => Math.max(unit === 'km' ? 500 : 5, interval * 0.1)

export interface StatusInput {
  machine: Pick<Machine, 'kind' | 'category'>
  log: MaintenanceLog[]
  /** GPS-Fahrten dieser Maschine (als Gerät oder Zugfahrzeug) */
  tracks: TrackSpan[]
  today: string
}

/** Fälligkeit einer Aufgabe: das Frühere aus Monaten und Zähler. Noch nie
 * erledigt → "offen" (erst ab dem ersten Eintrag lässt sich rechnen). */
export function taskStatus(task: MaintenanceTask, input: StatusInput): TaskStatus {
  const { machine, log, tracks, today } = input
  const unit = counterUnit(machine)
  const done = log
    .filter((l) => !l.deleted_at && parseTaskIds(l.task_ids).includes(task.id))
    .sort((a, b) => b.done_date.localeCompare(a.done_date) || (b.counter ?? 0) - (a.counter ?? 0))
  const last = done[0] ?? null
  if (!last) return { task, last: null, dueDate: null, daysLeft: null, countLeft: null, countUsed: null, state: 'offen' }

  let dueDate: string | null = null
  let daysLeft: number | null = null
  if (task.interval_months) {
    dueDate = addMonths(last.done_date, task.interval_months)
    daysLeft = daysBetween(today, dueDate)
  }

  let countLeft: number | null = null
  let countUsed: number | null = null
  if (task.interval_count) {
    const current = hasCounter(machine) ? latestCounter(log) : null
    if (current && last.counter != null) countUsed = Math.max(0, current.value - last.counter)
    else if (unit === 'h') countUsed = trackedHoursSince(tracks, last.done_date)
    if (countUsed != null) countLeft = task.interval_count - countUsed
  }

  const overdue = (daysLeft != null && daysLeft < 0) || (countLeft != null && countLeft <= 0)
  const soon =
    (daysLeft != null && daysLeft <= SOON_DAYS) || (countLeft != null && task.interval_count != null && countLeft <= soonCount(task.interval_count, unit))
  return { task, last, dueDate, daysLeft, countLeft, countUsed, state: overdue ? 'faellig' : soon ? 'bald' : 'ok' }
}

export const STATE_ORDER: Record<DueState, number> = { faellig: 0, bald: 1, offen: 2, ok: 3 }

// --- Standard-Wartungspläne ---

export interface TaskTemplate {
  key: string
  title: string
  type: MaintenanceTaskType
  /** Betriebsstunden bzw. km (Autos) */
  count?: number
  months?: number
  notes?: string
}

const T = (key: string, title: string, type: MaintenanceTaskType, count?: number, months?: number, notes?: string): TaskTemplate => ({
  key,
  title,
  type,
  count,
  months,
  notes,
})

/** Kontrolle vor der Saison für alle Geräte. */
const SEASON = T('saison', 'Kontrolle vor Saison: Schrauben, Schutz, Gelenkwelle, Beleuchtung', 'kontrolle', undefined, 12)
const PTO = T('gelenkwelle', 'Gelenkwelle schmieren (Kreuzgelenke, Schutzrohre)', 'schmieren', 8, undefined, 'Gemäss üblichen Herstellerangaben alle 8 Betriebsstunden.')
const GREASE = (h: number) => T('abschmieren', 'Abschmieren (alle Schmiernippel)', 'schmieren', h)
const GEARBOX = T('getriebeoel', 'Getriebeöl wechseln', 'oel', 500, 12, 'Ölstand vor jeder Saison prüfen.')
const BRAKES = T('bremsen', 'Bremsen und Bremsgestänge prüfen, einstellen', 'kontrolle', undefined, 12)
const TYRES = T('reifen', 'Reifendruck und Reifenzustand', 'kontrolle', undefined, 3)
const LIGHTS = T('beleuchtung', 'Beleuchtung und Strassenausrüstung', 'kontrolle', undefined, 12)
const HYDRAULIC_HOSES = T('schlaeuche', 'Hydraulikschläuche und Kupplungen prüfen', 'kontrolle', undefined, 12)

/** Typische Intervalle als Startpunkt — die Betriebsanleitung der Maschine
 * hat Vorrang (Werte im Plan anpassbar). */
export const TEMPLATES: Record<MachineKind, TaskTemplate[]> = {
  traktor: [
    T('motoroel', 'Motoröl und Ölfilter wechseln', 'oel', 500, 12),
    T('kraftstofffilter', 'Kraftstofffilter ersetzen, Wasserabscheider entleeren', 'filter', 500, 12),
    T('luftfilter', 'Luftfilter reinigen/prüfen', 'filter', 250, 12, 'Hauptelement nach Verschmutzungsanzeige, spätestens jährlich ersetzen.'),
    GREASE(50),
    T('hydraulikoel', 'Getriebe-/Hydrauliköl und Filter wechseln', 'oel', 1500, 24),
    T('kuehlmittel', 'Kühlmittel prüfen (Frostschutz), Kühler reinigen', 'kontrolle', undefined, 12),
    T('kuehlmittel_wechsel', 'Kühlmittel wechseln', 'service', undefined, 48),
    BRAKES,
    T('batterie', 'Batterie und Keilriemen prüfen', 'kontrolle', undefined, 12),
    TYRES,
    LIGHTS,
  ],
  hoflader: [
    T('motoroel', 'Motoröl und Ölfilter wechseln', 'oel', 250, 12),
    T('luftfilter', 'Luftfilter reinigen/prüfen', 'filter', 250, 12),
    T('abschmieren', 'Abschmieren: Knickgelenk, Schwinge, Schnellwechsler', 'schmieren', 10),
    T('hydraulikoel', 'Hydrauliköl und Filter wechseln', 'oel', 1000, 24),
    HYDRAULIC_HOSES,
    BRAKES,
    TYRES,
  ],
  motormaeher: [
    T('motoroel', 'Motoröl wechseln', 'oel', 50, 12),
    T('luftfilter', 'Luftfilter reinigen', 'filter', 25, 12),
    T('messer', 'Mähmesser schleifen/wechseln, Fingerbalken prüfen', 'verschleiss', 10),
    GREASE(10),
    T('getriebeoel', 'Getriebeöl prüfen/wechseln', 'oel', undefined, 12),
    T('zuendkerze', 'Zündkerze prüfen/ersetzen', 'kontrolle', 100, 12),
  ],
  auto: [
    T('service', 'Service: Motoröl und Filter', 'service', 15000, 12, 'Serviceintervall gemäss Serviceheft bzw. Anzeige.'),
    T('reifenwechsel', 'Reifenwechsel Sommer/Winter, Profil prüfen', 'kontrolle', undefined, 6),
    T('bremsfluessigkeit', 'Bremsflüssigkeit wechseln', 'service', undefined, 24),
    T('mfk', 'MFK (Motorfahrzeugkontrolle)', 'kontrolle', undefined, 24, 'Nach dem Aufgebot des Strassenverkehrsamts — Intervall anpassen.'),
    T('vignette', 'Autobahnvignette', 'andere', undefined, 12),
  ],
  maehwerk: [
    T('messer', 'Mähklingen und Klingenhalter prüfen', 'verschleiss', 8, undefined, 'Vor jedem Einsatz; beschädigte Klingen paarweise ersetzen.'),
    T('maehbalkenoel', 'Mähbalkenöl wechseln', 'oel', undefined, 12, 'Erster Wechsel nach 50 Stunden.'),
    GEARBOX,
    PTO,
    SEASON,
  ],
  aufbereiter: [GREASE(10), PTO, GEARBOX, T('zinken', 'Zinken, Bürste und Kamm prüfen', 'verschleiss', undefined, 12), SEASON],
  zettwender: [GREASE(20), PTO, T('zinken', 'Zinken prüfen/ersetzen', 'verschleiss', undefined, 12), GEARBOX, SEASON],
  pflug: [
    T('verschleiss', 'Schare, Anlagen, Streichbleche prüfen', 'verschleiss', 20, 12),
    GREASE(20),
    T('scherbolzen', 'Steinsicherung/Scherbolzen prüfen', 'kontrolle', undefined, 12),
    SEASON,
  ],
  kreiselegge: [GEARBOX, T('zinken', 'Zinken prüfen/ersetzen', 'verschleiss', 20), GREASE(20), PTO, SEASON],
  saatkombination: [
    GEARBOX,
    T('zinken', 'Kreiseleggen-Zinken prüfen/ersetzen', 'verschleiss', 20),
    T('saeaggregat', 'Säaggregat reinigen, Schare und Schläuche prüfen', 'kontrolle', undefined, 12),
    GREASE(20),
    PTO,
    SEASON,
  ],
  saemaschine: [T('saeaggregat', 'Säwellen, Schare und Striegel prüfen, reinigen', 'kontrolle', undefined, 12), GREASE(20), SEASON],
  duengerstreuer: [
    T('streuscheiben', 'Streuscheiben und Wurfschaufeln prüfen', 'verschleiss', undefined, 12),
    T('konservieren', 'Reinigen und konservieren (Dünger korrodiert)', 'kontrolle', undefined, 12),
    GREASE(20),
    SEASON,
  ],
  ladergeraet: [
    T('zustand', 'Zinken, Bolzen, Schweissnähte prüfen und schmieren', 'kontrolle', undefined, 12, 'Bei hydraulischen Geräten (Mistzange, Ballenzange) auch Schläuche und Kupplungen.'),
  ],
  guellefass: [
    T('pumpenoel', 'Vakuumpumpe: Ölstand prüfen, Öl nachfüllen', 'oel', 10),
    T('ventile', 'Ventile, Schieber und Dichtungen prüfen', 'kontrolle', undefined, 12),
    T('verteiler', 'Verteilerkopf: Messer prüfen, reinigen', 'verschleiss', 50, 12),
    GREASE(20),
    BRAKES,
    TYRES,
    LIGHTS,
  ],
  miststreuer: [
    GREASE(20),
    T('kratzboden', 'Kratzbodenketten spannen und prüfen', 'kontrolle', 20, 12),
    T('zinken', 'Streuwalzen-Zinken/Messer prüfen', 'verschleiss', undefined, 12),
    GEARBOX,
    BRAKES,
    TYRES,
    LIGHTS,
  ],
  ladewagen: [
    T('messer', 'Messer schleifen', 'verschleiss', 20),
    T('ketten', 'Kratzbodenketten spannen und schmieren', 'schmieren', 20),
    GREASE(20),
    PTO,
    GEARBOX,
    BRAKES,
    TYRES,
    LIGHTS,
  ],
  viehanhaenger: [
    BRAKES,
    TYRES,
    LIGHTS,
    T('rampe', 'Rampe, Türen, Scharniere und Verschlüsse schmieren/prüfen', 'schmieren', undefined, 6),
    T('radlager', 'Radlager und Achse prüfen', 'kontrolle', undefined, 12),
  ],
  schwader: [
    T('zinken', 'Zinken und Zinkenträger prüfen', 'verschleiss', 20, 12),
    GREASE(20),
    T('kurvenbahn', 'Kurvenbahn/Getriebe fetten', 'schmieren', undefined, 12),
    TYRES,
    LIGHTS,
  ],
  verschlauchung: [
    T('schlauch', 'Schlauch, Kupplungen und Dichtungen prüfen', 'kontrolle', undefined, 12),
    T('spuelen', 'Schlauch spülen und trocken lagern (vor Winter)', 'kontrolle', undefined, 12),
  ],
  andere: [SEASON],
}

/** Neue Aufgaben aus der Vorlage — nur die, deren Vorlage noch fehlt. */
export function tasksFromTemplate(machine: Pick<Machine, 'id' | 'kind'>, existing: MaintenanceTask[], newId: () => string): MaintenanceTask[] {
  const have = new Set(existing.filter((t) => t.machine_id === machine.id && !t.deleted_at).map((t) => t.template_key))
  const base = existing.filter((t) => t.machine_id === machine.id).length
  return (TEMPLATES[machine.kind] ?? [])
    .filter((t) => !have.has(t.key))
    .map((t, i) => ({
      id: newId(),
      machine_id: machine.id,
      title: t.title,
      task_type: t.type,
      interval_count: t.count ?? null,
      interval_months: t.months ?? null,
      notes: t.notes ?? null,
      active: true,
      sort_order: (base + i + 1) * 10,
      template_key: t.key,
      updated_at: '',
      deleted_at: null,
    }))
}

/** "alle 500 h oder jährlich" */
export function intervalText(t: Pick<MaintenanceTask, 'interval_count' | 'interval_months'>, unit: 'h' | 'km'): string {
  const parts: string[] = []
  if (t.interval_count) parts.push(`alle ${t.interval_count.toLocaleString('de-CH')} ${unit}`)
  if (t.interval_months) parts.push(t.interval_months === 12 ? 'jährlich' : `alle ${t.interval_months} Monate`)
  return parts.length ? parts.join(' oder ') : 'nach Bedarf'
}
