// Verlauf eines Tiers für die Tier-Info: alle Erfassungen (Geburten, Belegungen,
// Trächtigkeit, Journal, Klauen, Milchproben, Merklisten, Pendenzen) als eine
// Liste nach Datum, nach Thema einschränkbar.
import type { PGlite } from '@electric-sql/pglite'
import { examSummary, loadClawExams, type ClawExam } from './clawHealth'
import { fmtCells } from './culling'
import { addDays, fmtDate, isoDate, num } from './format'
import { categoryIcon, categoryLabel, journalSummary, supersededBy } from './journal'
import { METHOD_LABEL, RESULT_LABEL } from './pregnancy'
import type { Species } from './fertility'
import type { JournalCategory, PregnancyMethod, PregnancyResult } from '../types'

export type TimelineTopic = 'tier' | 'geburt' | 'belegung' | 'traechtigkeit' | 'gesundheit' | 'klauen' | 'milch' | 'beobachtung' | 'merkliste'

export interface TimelineItem {
  id: string
  date: string
  topic: TimelineTopic
  icon: string
  title: string
  detail?: string
  tone?: 'bad' | 'good'
  /** Abschnitt im Tierdetail (#…) oder Seite relativ zur Tier-Info */
  to: string
}

export function timelineTopics(species: Species): { key: TimelineTopic; label: string }[] {
  const sheep = species === 'sheep'
  return [
    { key: 'geburt', label: sheep ? 'Ablammungen' : 'Abkalbungen' },
    { key: 'belegung', label: sheep ? 'Belegung/Brunst' : 'Besamung/Brunst' },
    { key: 'traechtigkeit', label: 'Trächtigkeit' },
    { key: 'gesundheit', label: 'Gesundheit' },
    { key: 'klauen', label: 'Klauen' },
    { key: 'milch', label: 'Milchproben' },
    { key: 'beobachtung', label: 'Notizen' },
    { key: 'merkliste', label: 'Merklisten' },
    { key: 'tier', label: 'Geburt/Abgang' },
  ]
}

export interface TimelineInput {
  animal: { id: string; birth_date: string | null; exit_date: string | null; status: string }
  births: { id: string; birth_date: string; sire_name: string | null; sire_ear_tag: string | null; ease: number | null; notes: string | null; offspring: { sex: 'w' | 'm' | null; stillborn: boolean; died_24h: boolean }[] }[]
  matings: { id: string; service_date: string; service_to: string | null; kind: string | null; sire_name: string | null; sire_ear_tag: string | null; notes: string | null }[]
  checks: { id: string; check_date: string; result: PregnancyResult; method: PregnancyMethod | null; examiner: string | null; weeks: number | null; duration_unit: string | null; notes: string | null }[]
  journal: {
    id: string
    entry_date: string
    category: JournalCategory | null
    text: string
    diagnosis: string | null
    medication: string | null
    dose: string | null
    withdrawal_milk_days: number | null
    withdrawal_meat_days: number | null
    corrects_id: string | null
    updated_at?: string
  }[]
  claws: ClawExam[]
  tests: { id: string; test_date: string; milk_kg: number | null; fat_pct: number | null; protein_pct: number | null; cell_count: number | null }[]
  weighings: { id: string; session_date: string; bank_number: number; position: number; notes: string | null }[]
  lists: { id: string; name: string; reason: string | null; added_at: string; done_at: string | null }[]
  reminders: { id: string; due_date: string; title: string; done_at: string | null }[]
}

const pct = (v: number | null) => (v == null ? null : `${v.toFixed(2).replace(/0$/, '')} %`)
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ') || undefined

/** Alle Erfassungen eines Tiers als Verlaufseinträge (unsortiert). Korrigierte
 * Journaleinträge erscheinen nicht, nur die Korrektur. */
export function buildTimeline(input: TimelineInput, species: Species): TimelineItem[] {
  const sheep = species === 'sheep'
  const out: TimelineItem[] = []
  const a = input.animal
  if (a.birth_date) out.push({ id: 'tier:geboren', date: a.birth_date, topic: 'tier', icon: '🍼', title: 'Geboren', to: '#abstammung' })
  if (a.exit_date) out.push({ id: 'tier:abgang', date: a.exit_date, topic: 'tier', icon: '🚪', title: 'Abgang', to: '' })

  for (const b of input.births) {
    const n = b.offspring.length
    const alive = b.offspring.filter((o) => !o.stillborn && !o.died_24h).length
    const sexes = b.offspring.map((o) => (o.sex === 'm' ? '♂' : o.sex === 'w' ? '♀' : '?')).join(' ')
    out.push({
      id: `geburt:${b.id}`,
      date: b.birth_date,
      topic: 'geburt',
      icon: sheep ? '🐑' : '🐄',
      title: `${sheep ? 'Ablammung' : 'Abkalbung'}${n > 1 ? ` · Wurf ${n}` : n === 1 ? ' · Einling' : ''}`,
      detail: join(sexes, alive < n && `${alive} lebend`, (b.sire_name ?? b.sire_ear_tag) && `V ${b.sire_name ?? b.sire_ear_tag}`, b.ease != null && b.ease > 1 && `Verlauf ${b.ease}`, b.notes),
      tone: alive < n ? 'bad' : undefined,
      to: '#geburten',
    })
  }
  for (const m of input.matings)
    out.push({
      id: `belegung:${m.id}`,
      date: m.service_date,
      topic: 'belegung',
      icon: '❤️',
      title: m.kind === 'kb' ? 'Besamung' : m.service_to ? `Belegung bis ${m.service_to.slice(8, 10)}.${m.service_to.slice(5, 7)}.` : 'Belegung',
      detail: join(m.sire_name ?? m.sire_ear_tag, m.notes),
      to: '#belegungen',
    })
  for (const c of input.checks)
    out.push({
      id: `traechtigkeit:${c.id}`,
      date: c.check_date,
      topic: 'traechtigkeit',
      icon: '🤰',
      title: `Trächtigkeit: ${RESULT_LABEL[c.result]}`,
      detail: join(c.weeks != null && `${c.weeks} ${c.duration_unit === 'tage' ? 'Tage' : 'Wochen'}`, c.method && METHOD_LABEL[c.method], c.examiner, c.notes),
      tone: c.result === 'ja' ? 'good' : c.result === 'nein' ? 'bad' : undefined,
      to: '#kennzahlen',
    })

  const superseded = supersededBy(input.journal)
  for (const j of input.journal) {
    if (superseded.has(j.id)) continue
    const cat = j.category ?? 'notiz'
    const health = cat === 'krankheit' || cat === 'behandlung' || j.withdrawal_milk_days != null || j.withdrawal_meat_days != null
    const topic: TimelineTopic = health ? 'gesundheit' : cat === 'klauen' ? 'klauen' : cat === 'brunst' ? 'belegung' : 'beobachtung'
    const summary = journalSummary(j)
    const withdrawal = join(
      j.withdrawal_milk_days ? `Milch bis ${fmtDate(addDays(j.entry_date, j.withdrawal_milk_days))}` : null,
      j.withdrawal_meat_days ? `Fleisch bis ${fmtDate(addDays(j.entry_date, j.withdrawal_meat_days))}` : null,
    )
    out.push({
      id: `journal:${j.id}`,
      date: j.entry_date,
      topic,
      icon: categoryIcon(cat),
      title: health && summary !== categoryLabel(cat) ? `${categoryLabel(cat)}: ${summary}` : categoryLabel(cat),
      detail: join(j.text && j.text !== summary && j.text, withdrawal && `Absetzfrist ${withdrawal}`),
      tone: cat === 'krankheit' ? 'bad' : undefined,
      to: '#journal',
    })
  }
  for (const e of input.claws)
    out.push({
      id: `klauen:${e.id}`,
      date: e.exam_date,
      topic: 'klauen',
      icon: '🐾',
      title: 'Klauen beurteilt',
      detail: join(examSummary(e, species), e.examiner),
      to: '#klauen',
    })
  for (const t of input.tests)
    out.push({
      id: `milch:${t.id}`,
      date: t.test_date,
      topic: 'milch',
      icon: '🥛',
      title: `Milchprobe${t.milk_kg != null ? ` · ${t.milk_kg.toLocaleString('de-CH')} kg` : ''}`,
      detail: join(t.fat_pct != null && `Fett ${pct(t.fat_pct)}`, t.protein_pct != null && `Eiweiss ${pct(t.protein_pct)}`, t.cell_count != null && `Zellen ${fmtCells(t.cell_count)}`),
      to: '#milchproben',
    })
  for (const w of input.weighings)
    out.push({
      id: `waegung:${w.id}`,
      date: w.session_date,
      topic: 'milch',
      icon: '⚖️',
      title: 'Milchwägung',
      detail: join(`Bank ${w.bank_number}, Platz ${w.position}`, w.notes),
      to: '#milchproben',
    })
  for (const l of input.lists) {
    out.push({ id: `liste:${l.id}`, date: l.added_at, topic: 'merkliste', icon: '📋', title: `Auf Merkliste «${l.name}»`, detail: l.reason ?? undefined, to: '../merklisten' })
    if (l.done_at) out.push({ id: `liste-erledigt:${l.id}`, date: l.done_at, topic: 'merkliste', icon: '✓', title: `Merkliste «${l.name}» erledigt`, to: '../merklisten' })
  }
  for (const r of input.reminders)
    out.push({
      id: `pendenz:${r.id}`,
      date: r.due_date,
      topic: 'merkliste',
      icon: r.done_at ? '☑️' : '⏰',
      title: `Pendenz: ${r.title}`,
      detail: r.done_at ? `erledigt ${fmtDate(r.done_at)}` : 'offen',
      to: '#journal',
    })
  return out
}

/** Nach Thema einschränken und nach Datum sortieren (bei gleichem Datum feste Reihenfolge). */
export function filterTimeline(items: TimelineItem[], topic: TimelineTopic | 'alle', order: 'neu' | 'alt'): TimelineItem[] {
  const sign = order === 'neu' ? -1 : 1
  return items
    .filter((i) => topic === 'alle' || i.topic === topic)
    .sort((x, y) => (x.date === y.date ? x.id.localeCompare(y.id) : x.date < y.date ? -sign : sign))
}

const s = (v: unknown) => (v == null ? null : String(v))
const day = (v: unknown) => isoDate(v)!
/** timestamptz → Kalendertag in Ortszeit (nicht UTC) */
const localDay = (v: unknown) => (v instanceof Date ? v.toLocaleDateString('sv-SE') : isoDate(v))

/** Alle Erfassungen eines Tiers aus der lokalen Datenbank. */
export async function loadTimelineInput(pg: PGlite, animalId: string): Promise<Omit<TimelineInput, 'animal'>> {
  type Row = Record<string, unknown>
  const q = (sql: string) => pg.query<Row>(sql, [animalId]).then((r) => r.rows)
  const [births, offspring, matings, checks, journal, claws, tests, weighings, lists, reminders] = await Promise.all([
    q('select id, birth_date, sire_name, sire_ear_tag, ease, notes from births where dam_id = $1 and deleted_at is null'),
    q('select o.birth_id, o.sex, o.stillborn, o.died_24h from birth_offspring o join births b on b.id = o.birth_id where b.dam_id = $1 and o.deleted_at is null and b.deleted_at is null'),
    q('select id, service_date, service_to, kind, sire_name, sire_ear_tag, notes from matings where animal_id = $1 and deleted_at is null'),
    q('select id, check_date, result, method, examiner, weeks, duration_unit, notes from pregnancy_checks where animal_id = $1 and deleted_at is null'),
    q('select id, entry_date, category, text, diagnosis, medication, dose, withdrawal_milk_days, withdrawal_meat_days, corrects_id, updated_at from animal_journal where animal_id = $1 and deleted_at is null'),
    loadClawExams(pg, animalId),
    q('select id, test_date, milk_kg, fat_pct, protein_pct, cell_count from milk_tests where animal_id = $1 and deleted_at is null'),
    q(`select s.id, b.session_date, b.bank_number, s.position, s.notes from milking_slots s join milking_banks b on b.id = s.bank_id
       where s.animal_id = $1 and s.weighed and s.deleted_at is null and b.deleted_at is null`),
    q('select e.id, l.name, e.reason, e.added_at, e.done_at from watchlist_entries e join watchlists l on l.id = e.list_id where e.animal_id = $1 and e.deleted_at is null'),
    q('select id, due_date, title, done_at from reminders where animal_id = $1 and deleted_at is null'),
  ])
  const byBirth = new Map<string, TimelineInput['births'][number]['offspring']>()
  for (const o of offspring) {
    const k = String(o.birth_id)
    byBirth.set(k, [...(byBirth.get(k) ?? []), { sex: (o.sex as 'w' | 'm' | null) ?? null, stillborn: Boolean(o.stillborn), died_24h: Boolean(o.died_24h) }])
  }
  const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : s(v))
  return {
    births: births.map((b) => ({ id: String(b.id), birth_date: day(b.birth_date), sire_name: s(b.sire_name), sire_ear_tag: s(b.sire_ear_tag), ease: num(b.ease), notes: s(b.notes), offspring: byBirth.get(String(b.id)) ?? [] })),
    matings: matings.map((m) => ({ id: String(m.id), service_date: day(m.service_date), service_to: isoDate(m.service_to), kind: s(m.kind), sire_name: s(m.sire_name), sire_ear_tag: s(m.sire_ear_tag), notes: s(m.notes) })),
    checks: checks.map((c) => ({
      id: String(c.id),
      check_date: day(c.check_date),
      result: c.result as PregnancyResult,
      method: (c.method as PregnancyMethod | null) ?? null,
      examiner: s(c.examiner),
      weeks: num(c.weeks),
      duration_unit: s(c.duration_unit),
      notes: s(c.notes),
    })),
    journal: journal.map((j) => ({
      id: String(j.id),
      entry_date: day(j.entry_date),
      category: (j.category as JournalCategory | null) ?? null,
      text: String(j.text ?? ''),
      diagnosis: s(j.diagnosis),
      medication: s(j.medication),
      dose: s(j.dose),
      withdrawal_milk_days: num(j.withdrawal_milk_days),
      withdrawal_meat_days: num(j.withdrawal_meat_days),
      corrects_id: s(j.corrects_id),
      updated_at: ts(j.updated_at) ?? undefined,
    })),
    claws,
    tests: tests.map((t) => ({ id: String(t.id), test_date: day(t.test_date), milk_kg: num(t.milk_kg), fat_pct: num(t.fat_pct), protein_pct: num(t.protein_pct), cell_count: num(t.cell_count) })),
    weighings: weighings.map((w) => ({ id: String(w.id), session_date: day(w.session_date), bank_number: Number(w.bank_number), position: Number(w.position), notes: s(w.notes) })),
    lists: lists.map((l) => ({ id: String(l.id), name: String(l.name), reason: s(l.reason), added_at: localDay(l.added_at)!, done_at: localDay(l.done_at) })),
    reminders: reminders.map((r) => ({ id: String(r.id), due_date: day(r.due_date), title: String(r.title), done_at: localDay(r.done_at) })),
  }
}
