// Behandlungsjournal (schema/0013): Absetzfristen/Freigabe, Import der
// cownect-Behandlungsliste (xlsx) und Favoriten-Vorschläge aus der
// Geschichte. Reine Funktionen — Schreiben in lib/treatmentData.ts.

import { addDays } from './format'
import type { AnimalJournalEntry, TemplateItem } from '../types'

/** Bio-Betrieb: gesetzliche Absetzfristen verdoppeln — Voreinstellung beim
 * Erfassen und Einfügen; je Behandlung abwählbar. */
export const DEFAULT_WITHDRAWAL_FACTOR = 2

/** Erster Tag, an dem wieder geliefert werden darf: letzte Anwendung +
 * Frist × Faktor + 1. Ohne Frist (0/leer) null. */
export function releaseDate(lastDate: string, days: number | null, factor = 1): string | null {
  return days != null && days > 0 ? addDays(lastDate, days * factor + 1) : null
}

type WithdrawalFields = Pick<
  AnimalJournalEntry,
  'entry_date' | 'last_date' | 'withdrawal_milk_days' | 'withdrawal_meat_days' | 'withdrawal_factor' | 'release_milk_date' | 'release_meat_date'
>

/** Letzter Tag der Absetzfrist (Milch bzw. Fleisch) — aus dem gespeicherten
 * Freigabedatum, sonst gerechnet; null ohne Frist. */
export function withdrawalUntil(j: WithdrawalFields, kind: 'milk' | 'meat'): string | null {
  const release = kind === 'milk' ? j.release_milk_date : j.release_meat_date
  if (release) return addDays(release, -1)
  const days = kind === 'milk' ? j.withdrawal_milk_days : j.withdrawal_meat_days
  const r = releaseDate(j.last_date ?? j.entry_date, days == null ? null : Number(days), j.withdrawal_factor ?? 1)
  return r ? addDays(r, -1) : null
}

/** SQL: letzter Tag der Milch-Absetzfrist eines Journaleintrags `j` (null ohne Frist). */
export const MILK_UNTIL_SQL = `coalesce(j.release_milk_date - 1,
  case when j.withdrawal_milk_days > 0 then coalesce(j.last_date, j.entry_date) + j.withdrawal_milk_days * coalesce(j.withdrawal_factor, 1) end)`

/** "CH 120.1639.1520.0" → "CH120163915200" (Schreibweise in animals). */
export const normalizeEarTag = (s: string) => s.replace(/[\s.]/g, '').toUpperCase()

/** Deterministische UUID aus einem Text (FNV-1a, 4 Seeds) — gleiche
 * Import-Zeile ergibt dieselbe id, ein zweiter Import keine Dubletten. */
export function stableUuid(text: string): string {
  let hex = ''
  for (const seed of [0x811c9dc5, 0x01000193, 0x5bd1e995, 0x27d4eb2d]) {
    let h = seed >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    hex += h.toString(16).padStart(8, '0')
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** cownect-Absetzfrist "2x (3 / 4 / 4 / 4)" = Milch/Fleisch/Organe/Injektionsstelle, 2x = doppelt. */
export function parseWithdrawal(s: string | null | undefined): { factor: number; milk: number | null; meat: number | null } | null {
  const t = (s ?? '').trim()
  if (!t) return null
  const factor = /^(\d+)\s*x/i.exec(t)
  const nums = (t.replace(/^\d+\s*x\s*/i, '').match(/\d+/g) ?? []).map(Number)
  if (nums.length === 0) return null
  return { factor: factor ? Number(factor[1]) : 1, milk: nums[0], meat: nums.length > 1 ? Math.max(...nums.slice(1)) : null }
}

/** Datum aus Excel (Date, Seriennummer, "09.10.26", "2026-10-09") → ISO. */
export function cellDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    // +12 h: SheetJS liefert lokale Mitternacht, je nach Version um Sekunden versetzt
    const d = new Date(v.getTime() + 12 * 3_600_000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  const s = String(v).trim()
  const ch = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s)
  if (ch) return `${ch[3].length === 2 ? `20${ch[3]}` : ch[3]}-${ch[2].padStart(2, '0')}-${ch[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

const cleanAmount = (s: unknown) =>
  String(s ?? '')
    .trim()
    .replace(/(\d+)\.0\b/g, '$1')

export interface ImportedTreatment {
  import_key: string
  case_key: string
  ear_tag: string
  animal_name: string | null
  entry_date: string
  last_date: string | null
  body_system: string | null
  diagnosis: string | null
  administered_by: string | null
  supplier: string | null
  medication: string | null
  dose: string | null
  applications: number | null
  critical_antibiotic: boolean | null
  antibiogram: boolean | null
  withdrawal_factor: number | null
  withdrawal_milk_days: number | null
  withdrawal_meat_days: number | null
  release_milk_date: string | null
  release_meat_date: string | null
  /** Einsatz-/Behandlungsinfo */
  info: string | null
}

const COLS = {
  diagDate: 'Diagnosedatum',
  last: 'Letzte Behandlung',
  name: 'Tiername',
  tvd: 'TVD',
  os: 'OS, Position',
  findings: 'Befunde',
  by: 'beh. Pers.',
  supplier: 'Herkunft',
  start: 'Startdatum Medi',
  med: 'Handelsname',
  amountBase: 'Menge in Basiseinheit',
  amount: 'Menge in Ausb.einheiten',
  applications: 'Anzahl Appl.',
  critical: 'Kritische Antibiotika',
  useInfo: 'Medi-Einsatzinfo',
  antibiogram: 'Antibiogramm',
  withdrawal: 'Absetzfrist',
  relMilk: 'Freigabe Milch',
  relMeat: 'Freigabe Fleisch',
  relOrgans: 'Freigabe Organe',
  relInj: 'Freigabe Injektionsst.',
  info: 'Behandlungsinfo',
} as const

/** Behandlungsliste aus cownect (Export "Behandlungen", erste Zeile =
 * Spaltenköpfe) in Journalzeilen; je Präparat eine Zeile. */
export function parseCownect(rows: unknown[][]): { items: ImportedTreatment[]; skipped: number } {
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim())
  const col = (name: string) => header.findIndex((h) => h === name || h.startsWith(name))
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, v]) => [k, col(v)])) as Record<keyof typeof COLS, number>
  if (idx.tvd < 0 || idx.med < 0 || idx.diagDate < 0) throw new Error('Keine cownect-Behandlungsliste (Spalten TVD, Handelsname, Diagnosedatum fehlen).')
  const get = (r: unknown[], k: keyof typeof COLS) => (idx[k] < 0 ? null : r[idx[k]])
  const str = (r: unknown[], k: keyof typeof COLS) => {
    const v = String(get(r, k) ?? '').trim()
    return v === '' || v === '-' ? null : v
  }
  const yes = (r: unknown[], k: keyof typeof COLS) => (str(r, k) == null ? null : str(r, k)!.toLowerCase() === 'ja')
  const items: ImportedTreatment[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  for (const r of rows.slice(1)) {
    const tvd = str(r, 'tvd')
    const diagDate = cellDate(get(r, 'diagDate'))
    if (!tvd || !diagDate) {
      if (r.some((v) => v != null && v !== '')) skipped++
      continue
    }
    const ear = normalizeEarTag(tvd)
    const entry = cellDate(get(r, 'start')) ?? diagDate
    const last = cellDate(get(r, 'last'))
    const med = str(r, 'med')
    const amount = cleanAmount(get(r, 'amount'))
    const base = cleanAmount(get(r, 'amountBase'))
    const w = parseWithdrawal(str(r, 'withdrawal'))
    const meatRel = [cellDate(get(r, 'relMeat')), cellDate(get(r, 'relOrgans')), cellDate(get(r, 'relInj'))].filter((d): d is string => d != null).sort()
    const apps = Number(get(r, 'applications'))
    let key = ['cownect', ear, diagDate, entry, last ?? '', med ?? '', amount].join('|')
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > 1) key += `|${n}`
    items.push({
      import_key: key,
      case_key: ['cownect', ear, diagDate, str(r, 'findings') ?? ''].join('|'),
      ear_tag: ear,
      animal_name: str(r, 'name'),
      entry_date: entry,
      last_date: last && last !== entry ? last : null,
      body_system: str(r, 'os'),
      diagnosis: str(r, 'findings'),
      administered_by: str(r, 'by'),
      supplier: str(r, 'supplier'),
      medication: med,
      dose: amount ? (base && base !== amount ? `${amount} (${base})` : amount) : base || null,
      applications: Number.isFinite(apps) && apps > 0 ? apps : null,
      critical_antibiotic: yes(r, 'critical'),
      antibiogram: yes(r, 'antibiogram'),
      withdrawal_factor: w ? w.factor : null,
      withdrawal_milk_days: w ? w.milk : null,
      withdrawal_meat_days: w ? w.meat : null,
      release_milk_date: cellDate(get(r, 'relMilk')),
      release_meat_date: meatRel.at(-1) ?? null,
      info: [str(r, 'useInfo'), str(r, 'info')].filter(Boolean).join(' · ') || null,
    })
  }
  return { items, skipped }
}

// --- Favoriten ---

/** Schmerz- und Entzündungshemmer (NSAID) — erkennt, ob ein Fall schon eines enthält. */
const NSAID = /metacam|meloxi|ketopro|dinalgen|dolovet|flunixin|finadyne|rheumocam|loxicom|novem|metamizol|vetalgin|buscopan comp/i
export const isNsaid = (medication: string | null | undefined) => NSAID.test(medication ?? '')

export const NSAID_PLACEHOLDER: TemplateItem = {
  medication: '',
  dose: '',
  applications: 1,
  days: 1,
  milk_days: null,
  meat_days: null,
  hint: 'Schmerzmittel (NSAID) — Präparat und Dosis gemäss Bestandestierarzt',
}

export interface TemplateSuggestion {
  key: string
  title: string
  body_system: string | null
  diagnosis: string | null
  supplier: string | null
  items: TemplateItem[]
  count: number
  lastDate: string
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/** Kurztitel aus dem Befund: "Impfung; Blauzungenimpfung" → "Blauzungenimpfung". */
export function shortTitle(diagnosis: string | null, medication: string | null): string {
  const d = (diagnosis ?? '').split(';').map((s) => s.trim()).filter(Boolean)
  return d.at(-1) ?? (medication ?? 'Behandlung').split(/\s+ad us\.|,/)[0]
}

/** Typische Behandlungen aus dem Journal: Fälle mit gleichem Befund und
 * gleichen Präparaten, mind. `minCount`-mal; Mengen und Fristen vom
 * jüngsten Fall. Enthornen ohne Schmerzmittel bekommt einen NSAID-Platzhalter
 * (Pflicht nach Tierschutzverordnung). */
export function suggestTemplates(entries: AnimalJournalEntry[], minCount = 2): TemplateSuggestion[] {
  const cases = new Map<string, AnimalJournalEntry[]>()
  for (const e of entries) {
    if (e.deleted_at || e.category !== 'behandlung' || !e.medication) continue
    const k = e.case_id ?? e.id
    cases.set(k, [...(cases.get(k) ?? []), e])
  }
  const groups = new Map<string, AnimalJournalEntry[][]>()
  for (const rows of cases.values()) {
    const meds = [...new Set(rows.map((r) => r.medication!.split(/\s+ad\.?\s*us\.|,/)[0].trim().toLowerCase()))].sort()
    const k = `${(rows[0].diagnosis ?? '').toLowerCase()}|${meds.join('+')}`
    groups.set(k, [...(groups.get(k) ?? []), rows])
  }
  const out: TemplateSuggestion[] = []
  for (const [key, list] of groups) {
    if (list.length < minCount) continue
    const latest = list.reduce((a, b) => (b[0].entry_date > a[0].entry_date ? b : a))
    const first = latest[0]
    const items: TemplateItem[] = latest.map((r) => ({
      medication: r.medication!,
      dose: r.dose ?? '',
      applications: r.applications,
      days: r.last_date ? daysBetween(r.entry_date, r.last_date) + 1 : 1,
      milk_days: r.withdrawal_milk_days,
      meat_days: r.withdrawal_meat_days,
    }))
    const title = shortTitle(first.diagnosis, first.medication)
    if (/enthorn/i.test(title) && !items.some((i) => isNsaid(i.medication))) items.push({ ...NSAID_PLACEHOLDER })
    out.push({
      key,
      title,
      body_system: first.body_system,
      diagnosis: first.diagnosis,
      supplier: first.supplier,
      items,
      count: list.length,
      lastDate: first.entry_date,
    })
  }
  // je Titel nur die häufigste Variante (seltenere von Hand als Favorit anlegen)
  const seen = new Set<string>()
  return out
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
    .filter((s) => !seen.has(s.title.toLowerCase()) && !!seen.add(s.title.toLowerCase()))
}

export function parseItems(json: string | null | undefined): TemplateItem[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(v) ? (v as TemplateItem[]) : []
  } catch {
    return []
  }
}
