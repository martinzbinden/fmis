// Klauengesundheit (schema/0020): Befundkatalog je Tierart und Auswertung.
//
// Rinder: Befundschlüssel nach dem ICAR-Klauengesundheitsatlas (ICAR Claw Health Atlas), den das
// Schweizer Klauengesundheitsprojekt verbindlich verwendet; Dermatitis digitalis mit M-Stadien
// (Atlas, Anhang 1). Lahmheit 1–5 (Locomotion Score nach Sprecher et al. 1997).
// Schafe: Moderhinke-Score je Fuss 0–5 (Egerton & Roberts 1971: 0–4, in Schweizer Studien bis 5
// = grossflächige Ablösung des Klauenhorns, z.B. Härdi-Landerer et al., SAT 2017); je Tier zählt
// der am schwersten betroffene Fuss. Weitere Schafbefunde ohne internationalen Schlüssel.

import type { PGlite } from '@electric-sql/pglite'
import type { Species } from './fertility'
import { isoDate } from './format'

export const FEET = ['VL', 'VR', 'HL', 'HR'] as const
export type Foot = (typeof FEET)[number]
export const FOOT_LABEL: Record<Foot, string> = { VL: 'vorne links', VR: 'vorne rechts', HL: 'hinten links', HR: 'hinten rechts' }

export interface ClawCode {
  code: string
  label: string
  group: 'Infektiös' | 'Horn / Lederhaut' | 'Form' | 'Weitere'
  /** Schweregrade; ohne Angabe nur vorhanden/nicht vorhanden */
  grades?: string[]
}

const MILD_SEVERE = ['leicht', 'schwer']

/** Rinder: Befunde des ICAR-Klauengesundheitsatlas (Kürzel wie im Atlas). */
export const CATTLE_CODES: ClawCode[] = [
  { code: 'DD', label: 'Dermatitis digitalis (Mortellaro)', group: 'Infektiös', grades: ['M1', 'M2', 'M3', 'M4', 'M4.1'] },
  { code: 'ID', label: 'Dermatitis interdigitalis', group: 'Infektiös', grades: MILD_SEVERE },
  { code: 'HHE', label: 'Ballenhornfäule', group: 'Infektiös', grades: MILD_SEVERE },
  { code: 'IP', label: 'Phlegmona interdigitalis (Panaritium)', group: 'Infektiös' },
  { code: 'SU', label: 'Sohlengeschwür (Rusterholz)', group: 'Horn / Lederhaut' },
  { code: 'TU', label: 'Klauenspitzengeschwür', group: 'Horn / Lederhaut' },
  { code: 'BU', label: 'Ballengeschwür', group: 'Horn / Lederhaut' },
  { code: 'WL', label: 'Weisse-Linie-Defekt', group: 'Horn / Lederhaut', grades: MILD_SEVERE },
  { code: 'SH', label: 'Sohlenblutung', group: 'Horn / Lederhaut', grades: ['umschrieben', 'diffus'] },
  { code: 'DS', label: 'Doppelsohle', group: 'Horn / Lederhaut' },
  { code: 'TS', label: 'Dünne Sohle', group: 'Horn / Lederhaut' },
  { code: 'TN', label: 'Klauenspitzennekrose', group: 'Horn / Lederhaut' },
  { code: 'AF', label: 'Hornspalt axial', group: 'Horn / Lederhaut' },
  { code: 'HF', label: 'Hornspalt horizontal (Hornkluft)', group: 'Horn / Lederhaut' },
  { code: 'VF', label: 'Hornspalt vertikal (Wandspalt)', group: 'Horn / Lederhaut' },
  { code: 'IH', label: 'Zwischenklauenwulst (Limax)', group: 'Weitere', grades: MILD_SEVERE },
  { code: 'SW', label: 'Schwellung Krone/Ballen', group: 'Weitere' },
  { code: 'CW', label: 'Konkave Vorderwand (Rehklaue)', group: 'Form' },
  { code: 'CC', label: 'Korkenzieherklaue', group: 'Form' },
]

/** Schafe: Befunde neben dem Moderhinke-Score (eigene Kürzel, kein internationaler Schlüssel). */
export const SHEEP_CODES: ClawCode[] = [
  { code: 'CODD', label: 'Kontagiöse Dermatitis digitalis (CODD)', group: 'Infektiös' },
  { code: 'ABS', label: 'Klauenabszess', group: 'Infektiös' },
  { code: 'WL', label: 'Weisse-Linie-Defekt (lose Wand)', group: 'Horn / Lederhaut' },
  { code: 'GRA', label: 'Granulom', group: 'Horn / Lederhaut' },
  { code: 'LANG', label: 'Klauen überlang / Formfehler', group: 'Form' },
]

export const MH_SCORES: { score: number; label: string }[] = [
  { score: 0, label: 'gesund' },
  { score: 1, label: 'leichte Zwischenklauenentzündung' },
  { score: 2, label: 'ausgedehnte Zwischenklauenentzündung' },
  { score: 3, label: 'Ballen-/Sohlenhorn unterminiert' },
  { score: 4, label: 'Unterminierung bis ins Wandhorn' },
  { score: 5, label: 'grossflächige Ablösung des Klauenhorns' },
]

export const CATTLE_LOCOMOTION: { score: number; label: string }[] = [
  { score: 1, label: 'normal' },
  { score: 2, label: 'leicht lahm' },
  { score: 3, label: 'mässig lahm' },
  { score: 4, label: 'lahm' },
  { score: 5, label: 'hochgradig lahm' },
]

export const TREATMENTS: Record<Species, string[]> = {
  cattle: ['Klotz', 'Verband', 'Spray', 'Klauenbad', 'Tierarzt'],
  sheep: ['Ausgeschnitten', 'Spray', 'Klauenbad', 'Tierarzt'],
}

export const codesFor = (species: Species) => (species === 'sheep' ? SHEEP_CODES : CATTLE_CODES)
export const codeLabel = (species: Species, code: string) => (code === 'MH' ? 'Moderhinke' : (codesFor(species).find((c) => c.code === code)?.label ?? code))

export interface ClawFinding {
  id: string
  exam_id: string
  animal_id: string
  foot: Foot | null
  claw: 'innen' | 'aussen' | null
  code: string
  grade: string | null
  zone: number | null
}

export interface ClawExam {
  id: string
  animal_id: string
  exam_date: string
  round_id: string | null
  examiner: string | null
  locomotion: number | null
  trimmed: boolean
  treatment: string | null
  notes: string | null
  source: 'manual' | 'reader' | 'import'
  recorded_at: string
  created_by: string | null
  findings: ClawFinding[]
}

const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

/** Alle Untersuchungen mit Befunden, neueste zuerst. */
export async function loadClawExams(pg: PGlite): Promise<ClawExam[]> {
  const [exams, findings] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from claw_exams where deleted_at is null order by exam_date desc, recorded_at desc'),
    pg.query<Record<string, unknown>>('select * from claw_findings where deleted_at is null'),
  ])
  const byExam = new Map<string, ClawFinding[]>()
  for (const f of findings.rows) {
    const row: ClawFinding = {
      id: String(f.id),
      exam_id: String(f.exam_id),
      animal_id: String(f.animal_id),
      foot: (f.foot as Foot | null) ?? null,
      claw: (f.claw as ClawFinding['claw']) ?? null,
      code: String(f.code),
      grade: (f.grade as string | null) ?? null,
      zone: f.zone == null ? null : Number(f.zone),
    }
    byExam.set(row.exam_id, [...(byExam.get(row.exam_id) ?? []), row])
  }
  return exams.rows.map((e) => ({
    id: String(e.id),
    animal_id: String(e.animal_id),
    exam_date: isoDate(e.exam_date)!,
    round_id: (e.round_id as string | null) ?? null,
    examiner: (e.examiner as string | null) ?? null,
    locomotion: e.locomotion == null ? null : Number(e.locomotion),
    trimmed: Boolean(e.trimmed),
    treatment: (e.treatment as string | null) ?? null,
    notes: (e.notes as string | null) ?? null,
    source: (e.source as ClawExam['source']) ?? 'manual',
    recorded_at: ts(e.recorded_at),
    created_by: (e.created_by as string | null) ?? null,
    findings: byExam.get(String(e.id)) ?? [],
  }))
}

/** Moderhinke-Score des am schwersten betroffenen Fusses (null = nicht beurteilt). */
export function worstMh(exam: Pick<ClawExam, 'findings'>): number | null {
  const scores = exam.findings.filter((f) => f.code === 'MH' && f.grade != null).map((f) => Number(f.grade))
  return scores.length ? Math.max(...scores) : null
}

/** Lahm: Rinder ab Locomotion Score 3, Schafe locomotion 1 (= lahm). */
export function isLame(exam: Pick<ClawExam, 'locomotion'>, species: Species): boolean {
  return exam.locomotion != null && (species === 'sheep' ? exam.locomotion >= 1 : exam.locomotion >= 3)
}

/** Befunde ausser Moderhinke-Score 0 (= etwas gefunden). */
export const lesions = (exam: Pick<ClawExam, 'findings'>) => exam.findings.filter((f) => !(f.code === 'MH' && Number(f.grade) === 0))

/** Kurzer Text für Listen, z.B. «MH 3 (VL 3, HR 1) · lahm · geschnitten». */
export function examSummary(exam: ClawExam, species: Species): string {
  const parts: string[] = []
  const mh = worstMh(exam)
  if (mh != null) {
    const feet = exam.findings
      .filter((f) => f.code === 'MH' && Number(f.grade) > 0)
      .map((f) => `${f.foot ?? '?'} ${f.grade}`)
    parts.push(mh === 0 ? 'MH 0' : `MH ${mh} (${feet.join(', ')})`)
  }
  const other = exam.findings.filter((f) => f.code !== 'MH')
  if (other.length) parts.push(other.map((f) => `${f.code}${f.grade ? ` ${f.grade}` : ''}${f.foot ? ` ${f.foot}` : ''}`).join(', '))
  if (species === 'cattle' && exam.locomotion != null) parts.push(`Lahmheit ${exam.locomotion}`)
  else if (isLame(exam, species)) parts.push('lahm')
  if (exam.trimmed) parts.push('geschnitten')
  if (exam.treatment) parts.push(exam.treatment)
  if (!parts.length) return 'ohne Befund'
  return parts.join(' · ')
}

export interface ClawStatus {
  last: ClawExam
  /** Moderhinke des letzten Befunds (Schafe) */
  mh: number | null
  lame: boolean
  lesionCodes: string[]
  /** Untersuchungen mit Befund in den letzten 365 Tagen */
  affected12m: number
}

/** Letzter Stand je Tier (exams neueste zuerst). */
export function clawStatusByAnimal(exams: ClawExam[], species: Species, today: string): Map<string, ClawStatus> {
  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10)
  const out = new Map<string, ClawStatus>()
  for (const e of exams) {
    const s = out.get(e.animal_id)
    const affected = e.exam_date >= yearAgo && (lesions(e).length > 0 || isLame(e, species)) ? 1 : 0
    if (!s) {
      out.set(e.animal_id, { last: e, mh: worstMh(e), lame: isLame(e, species), lesionCodes: [...new Set(lesions(e).map((f) => f.code))], affected12m: affected })
    } else s.affected12m += affected
  }
  return out
}

export interface ClawWarning {
  id: string
  text: string
  suggestList?: string
}

/** Warnungen beim Erfassen: wiederholter Befund innert 12 Monaten, schwere Moderhinke. */
export function clawWarnings(animalId: string, current: { date: string; mh: number | null; codes: string[]; examId?: string }, history: ClawExam[], cullList: string): ClawWarning[] {
  const yearAgo = new Date(Date.parse(`${current.date}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10)
  const earlier = history.filter((e) => e.animal_id === animalId && e.id !== current.examId && e.exam_date < current.date && e.exam_date >= yearAgo)
  const out: ClawWarning[] = []
  if (current.mh != null && current.mh > 0) {
    const prev = earlier.find((e) => (worstMh(e) ?? 0) > 0)
    if (prev) out.push({ id: `${animalId}:claw:mh-repeat`, text: `Moderhinke schon am ${prev.exam_date.split('-').reverse().join('.')} (Score ${worstMh(prev)}) – wiederholt erkrankt, kann Grund für die Ausmerzung sein.`, suggestList: cullList })
    if (current.mh >= 3) out.push({ id: `${animalId}:claw:mh-severe`, text: `Schwere Moderhinke (Score ${current.mh}): absondern, behandeln, Nachkontrolle.`, suggestList: 'Klauen nachkontrollieren' })
  }
  for (const code of current.codes) {
    const prev = earlier.find((e) => e.findings.some((f) => f.code === code))
    if (prev) out.push({ id: `${animalId}:claw:${code}`, text: `${code} schon am ${prev.exam_date.split('-').reverse().join('.')} – wiederholter Befund.`, suggestList: cullList })
  }
  return out
}
