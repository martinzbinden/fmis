// Arbeiten planen über Parzellen hinaus (schema/0014_work_tasks.sql): an und mit Tieren (Einzeltiere, Tiergruppen),
// Gebäuden, Maschinen, Brennholz und frei erfasste Arbeiten. Erledigt schreibt:
// - Tiere → Stalljournal des Tiermoduls (AnimalProvider.addJournal; je Tier ein Eintrag), Tiere ohne Stalljournal
//   (z.B. Mastplaner) → Betriebsjournal
// - Maschinen → Betriebsjournal und Maschinenjournal (maintenance_log)
// - Gebäude, Brennholz, frei → Betriebsjournal (farm_journal)
// Parzellen-Arbeiten bleiben geplante Einträge im Wiesenjournal (lib/workPlan.ts).

import type { PGlite } from '@electric-sql/pglite'
import { animalProviders, herdLocator, listAllAnimals } from '@fmis/core/animals'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow } from '../db/write'
import { isoDate, num } from './format'

export type TaskArea = 'tiere' | 'gebaeude' | 'maschine' | 'brennholz' | 'frei'

export type TaskTarget =
  | { kind: 'tier'; module: string; id: string; label: string }
  | { kind: 'gruppe'; id: string; label: string }
  | { kind: 'maschine'; id: string; label: string }
  | { kind: 'objekt'; label: string }

export interface WorkTask {
  id: string
  title: string
  area: TaskArea
  targets: TaskTarget[]
  planned_date: string | null
  due_date: string | null
  person_id: string | null
  quantity: number | null
  unit: string | null
  notes: string | null
  source: string
  source_ref: string | null
  customer: string | null
  status: 'offen' | 'erledigt' | 'abgesagt'
  done_date: string | null
  done_by: string | null
  result_notes: string | null
  journal_refs: string | null
  created_by: string | null
}

export interface FarmJournalEntry {
  id: string
  entry_date: string
  area: string
  title: string
  targets: TaskTarget[]
  quantity: number | null
  unit: string | null
  notes: string | null
  task_id: string | null
  customer: string | null
  done_by: string | null
}

export const AREA_LABEL: Record<TaskArea, string> = { tiere: 'Tiere', gebaeude: 'Gebäude', maschine: 'Maschinen', brennholz: 'Brennholz', frei: 'Weitere' }
export const AREA_ICON: Record<TaskArea, string> = { tiere: 'gruppen', gebaeude: 'hof', maschine: 'traktor', brennholz: 'holz', frei: 'erfassen' }

/** Kategorien des Stalljournals (dairy schema 0027), wählbar beim Abschliessen von Tierarbeiten. */
export const STABLE_CATEGORIES: Record<string, string> = { notiz: 'Notiz', beobachtung: 'Beobachtung', behandlung: 'Behandlung', klauen: 'Klauen', fuetterung: 'Fütterung', krankheit: 'Krankheit' }

export interface Activity {
  key: string
  title: string
  area: TaskArea
  /** weitere Suchwörter */
  keywords?: string
  /** Stalljournal-Kategorie beim Abschliessen (Tiere) */
  category?: string
  /** Eintragsart im Maschinenjournal (Maschinen) */
  logType?: 'wartung' | 'reparatur' | 'kontrolle'
  unit?: string
}

/** Tätigkeiten zum Suchen; jede Arbeit kann auch frei benannt werden. */
export const ACTIVITIES: Activity[] = [
  { key: 'klauen', title: 'Klauen schneiden', area: 'tiere', category: 'klauen', keywords: 'klauenpflege' },
  { key: 'klauenbad', title: 'Klauenbad', area: 'tiere', category: 'klauen' },
  { key: 'entwurmen', title: 'Entwurmen', area: 'tiere', category: 'behandlung', keywords: 'drench wurmkur' },
  { key: 'impfen', title: 'Impfen', area: 'tiere', category: 'behandlung', keywords: 'impfung' },
  { key: 'behandeln', title: 'Behandlung', area: 'tiere', category: 'behandlung', keywords: 'medikament tierarzt' },
  { key: 'tierarzt', title: 'Tierarzt-Besuch', area: 'tiere', category: 'behandlung' },
  { key: 'scheren', title: 'Scheren', area: 'tiere', category: 'notiz', keywords: 'schur wolle' },
  { key: 'waegen', title: 'Wägen', area: 'tiere', category: 'notiz', keywords: 'gewicht' },
  { key: 'kontrolle-tiere', title: 'Kontrolle', area: 'tiere', category: 'beobachtung', keywords: 'nachkontrolle' },
  { key: 'umstallen', title: 'Umstallen', area: 'tiere', category: 'notiz', keywords: 'zügeln' },
  { key: 'futter', title: 'Fütterung umstellen', area: 'tiere', category: 'fuetterung', keywords: 'futter ration' },
  { key: 'ohrmarken', title: 'Ohrmarken einziehen', area: 'tiere', category: 'notiz' },
  { key: 'reparatur-gebaeude', title: 'Reparatur', area: 'gebaeude', keywords: 'flicken' },
  { key: 'reinigen', title: 'Reinigen', area: 'gebaeude', keywords: 'putzen waschen' },
  { key: 'ausmisten', title: 'Ausmisten', area: 'gebaeude', keywords: 'mist stall' },
  { key: 'einstreuen', title: 'Einstreuen', area: 'gebaeude', keywords: 'stroh' },
  { key: 'zaun', title: 'Zaun reparieren', area: 'gebaeude', keywords: 'weidezaun' },
  { key: 'traenke', title: 'Tränke kontrollieren', area: 'gebaeude', keywords: 'wasser' },
  { key: 'service', title: 'Service', area: 'maschine', logType: 'wartung', keywords: 'wartung' },
  { key: 'oel', title: 'Ölwechsel', area: 'maschine', logType: 'wartung', keywords: 'öl filter' },
  { key: 'schmieren', title: 'Abschmieren', area: 'maschine', logType: 'wartung', keywords: 'fett' },
  { key: 'reparatur-maschine', title: 'Reparatur', area: 'maschine', logType: 'reparatur', keywords: 'defekt' },
  { key: 'reinigen-maschine', title: 'Reinigen', area: 'maschine', logType: 'wartung', keywords: 'waschen' },
  { key: 'kontrolle-maschine', title: 'Kontrolle', area: 'maschine', logType: 'kontrolle', keywords: 'mfk prüfen' },
  { key: 'faellen', title: 'Holz fällen', area: 'brennholz', unit: 'Ster', keywords: 'wald' },
  { key: 'ruesten', title: 'Brennholz rüsten', area: 'brennholz', unit: 'Ster', keywords: 'sägen' },
  { key: 'spalten', title: 'Holz spalten', area: 'brennholz', unit: 'Ster' },
  { key: 'aufschichten', title: 'Holz aufschichten', area: 'brennholz', unit: 'Ster' },
  { key: 'liefern', title: 'Brennholz liefern', area: 'brennholz', unit: 'Ster', keywords: 'lieferung kunde' },
]

export const activityByTitle = (title: string, area?: TaskArea) => ACTIVITIES.find((a) => a.title === title && (!area || a.area === area))

const parseTargets = (v: unknown): TaskTarget[] => {
  try {
    const t = JSON.parse(String(v ?? '[]')) as TaskTarget[]
    return Array.isArray(t) ? t : []
  } catch {
    return []
  }
}

/** Bereich aus den Zielen und der Tätigkeit (Tiere vor Maschinen vor Gebäuden). */
export function areaFor(targets: TaskTarget[], activity: Activity | null): TaskArea {
  if (targets.some((t) => t.kind === 'tier' || t.kind === 'gruppe')) return 'tiere'
  if (targets.some((t) => t.kind === 'maschine')) return 'maschine'
  if (activity) return activity.area
  if (targets.some((t) => t.kind === 'objekt')) return 'gebaeude'
  return 'frei'
}

export async function loadWorkTasks(pg: PGlite): Promise<WorkTask[]> {
  const { rows } = await pg.query<Record<string, unknown>>("select * from work_tasks where deleted_at is null and status = 'offen' order by planned_date nulls last, title")
  return rows.map((r) => ({
    ...(r as unknown as WorkTask),
    targets: parseTargets(r.targets),
    planned_date: r.planned_date ? isoDate(r.planned_date) : null,
    due_date: r.due_date ? isoDate(r.due_date) : null,
    done_date: r.done_date ? isoDate(r.done_date) : null,
    quantity: num(r.quantity) ?? null,
  }))
}

export async function loadFarmJournal(pg: PGlite, since: string): Promise<FarmJournalEntry[]> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from farm_journal where deleted_at is null and entry_date >= $1 order by entry_date desc, updated_at desc', [since])
  return rows.map((r) => ({ ...(r as unknown as FarmJournalEntry), entry_date: isoDate(r.entry_date), targets: parseTargets(r.targets), quantity: num(r.quantity) ?? null }))
}

/** Bisher benutzte Objekte (Gebäude u.ä.) für die Suche. */
export async function knownObjects(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ targets: string }>("select targets from work_tasks where deleted_at is null and targets like '%objekt%' union all select targets from farm_journal where deleted_at is null and targets like '%objekt%'")
  const out = new Set<string>()
  for (const r of rows) for (const t of parseTargets(r.targets)) if (t.kind === 'objekt') out.add(t.label)
  return [...out].sort((a, b) => a.localeCompare(b, 'de'))
}

export type TaskDraft = Omit<WorkTask, 'id' | 'status' | 'done_date' | 'done_by' | 'result_notes' | 'journal_refs' | 'created_by' | 'source' | 'source_ref'> & { id?: string; source?: string; source_ref?: string | null }

export async function saveWorkTask(t: TaskDraft): Promise<string> {
  const id = t.id ?? crypto.randomUUID()
  await upsertRow('work_tasks', {
    id,
    title: t.title.trim(),
    area: t.area,
    targets: JSON.stringify(t.targets),
    planned_date: t.planned_date,
    due_date: t.due_date,
    person_id: t.person_id,
    quantity: t.quantity,
    unit: t.unit,
    notes: t.notes,
    source: t.source ?? 'manuell',
    source_ref: t.source_ref ?? null,
    customer: t.customer,
    status: 'offen',
    done_date: null,
    done_by: null,
    result_notes: null,
    journal_refs: null,
    created_by: getCurrentUserEmail(),
    deleted_at: null,
  } as never)
  return id
}

export async function cancelWorkTask(t: WorkTask): Promise<void> {
  await upsertRow('work_tasks', { ...t, targets: JSON.stringify(t.targets), status: 'abgesagt' } as never)
}

export interface Completion {
  date: string
  notes: string
  /** Stalljournal (Tiere) */
  category?: string
  medication?: string
  dose?: string
  doneBy?: string
  quantity?: number | null
}

/** Tierziele zu Einzeltieren je Modul auflösen (Gruppen am Ausführungstag). */
export async function resolveAnimals(targets: TaskTarget[], date: string): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>()
  const add = (module: string, id: string) => out.set(module, (out.get(module) ?? new Set()).add(id))
  for (const t of targets) if (t.kind === 'tier') add(t.module, t.id)
  const groupIds = targets.filter((t) => t.kind === 'gruppe').map((t) => t.id)
  if (groupIds.length) {
    const groups = (await herdLocator()?.groups?.(date)) ?? []
    const ids = groups.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.animalIds)
    if (ids.length) {
      const moduleOf = new Map((await listAllAnimals()).map((a) => [a.id, a.moduleKey]))
      for (const id of ids) {
        const m = moduleOf.get(id)
        if (m) add(m, id)
      }
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

/** Arbeit abschliessen: Journale schreiben, Plan auf «erledigt». Gibt zurück, wohin geschrieben wurde. */
export async function completeWorkTask(t: WorkTask, c: Completion): Promise<string[]> {
  const by = c.doneBy?.trim() || getCurrentUserEmail()
  const text = [t.title, c.notes.trim()].filter(Boolean).join(': ')
  const refs: string[] = []
  const rest: TaskTarget[] = t.targets.filter((x) => x.kind !== 'tier' && x.kind !== 'gruppe')
  const quantity = c.quantity !== undefined ? c.quantity : t.quantity

  if (t.targets.some((x) => x.kind === 'tier' || x.kind === 'gruppe')) {
    const byModule = await resolveAnimals(t.targets, c.date)
    const providers = new Map(animalProviders())
    for (const [module, ids] of byModule) {
      const p = providers.get(module)
      if (p?.addJournal) {
        await p.addJournal(ids, { date: c.date, category: c.category ?? activityByTitle(t.title, 'tiere')?.category ?? 'notiz', text, medication: c.medication || null, dose: c.dose || null, administered_by: by })
        refs.push(`Stalljournal ${p.title}: ${ids.length} ${ids.length === 1 ? 'Tier' : 'Tiere'}`)
      } else {
        // Tiere ohne Stalljournal: als Ziel im Betriebsjournal
        for (const x of t.targets) if (x.kind === 'tier' && x.module === module) rest.push(x)
      }
    }
    if (byModule.size === 0) refs.push('keine Tiere gefunden (Gruppe leer?)')
  }

  const needsFarm = t.area !== 'tiere' || rest.length > 0
  if (needsFarm) {
    const id = crypto.randomUUID()
    await upsertRow('farm_journal', {
      id,
      entry_date: c.date,
      area: t.area,
      title: t.title,
      targets: JSON.stringify(t.area === 'tiere' ? rest : t.targets),
      quantity,
      unit: t.unit,
      notes: c.notes.trim() || t.notes,
      task_id: t.id,
      customer: t.customer,
      done_by: by,
      created_by: getCurrentUserEmail(),
      deleted_at: null,
    } as never)
    refs.push('Betriebsjournal')
  }
  for (const m of t.targets.filter((x) => x.kind === 'maschine')) {
    await upsertRow('maintenance_log', {
      id: crypto.randomUUID(),
      machine_id: m.id,
      done_date: c.date,
      entry_type: activityByTitle(t.title, 'maschine')?.logType ?? 'wartung',
      title: t.title,
      task_ids: null,
      counter: null,
      cost_chf: null,
      material: null,
      done_by: by,
      notes: c.notes.trim() || t.notes,
      deleted_at: null,
    } as never)
    refs.push(`Maschinenjournal ${m.label}`)
  }

  await upsertRow('work_tasks', {
    ...t,
    targets: JSON.stringify(t.targets),
    quantity,
    status: 'erledigt',
    done_date: c.date,
    done_by: by,
    result_notes: c.notes.trim() || null,
    journal_refs: JSON.stringify(refs),
  } as never)
  return refs
}

export const targetIcon: Record<TaskTarget['kind'], string> = { tier: 'schaf', gruppe: 'gruppen', maschine: 'traktor', objekt: 'hof' }
export const targetsText = (ts: TaskTarget[]) => ts.map((t) => t.label).join(', ')
