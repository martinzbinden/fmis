import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import { notifyError } from '@fmis/core/toast'
import { matchRead, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'
import { inTransaction } from '../db/transaction'
import { softDeleteRow, upsertRow } from '../db/write'
import { useQuery } from '../hooks/useQuery'
import AnimalWarnings from '../components/AnimalWarnings'
import { CULL_LIST, type AnimalWarning } from '../lib/animalWarnings'
import {
  CATTLE_LOCOMOTION,
  clawStatusByAnimal,
  clawWarnings,
  codeLabel,
  codesFor,
  examSummary,
  FEET,
  FOOT_LABEL,
  isLame,
  lesions,
  loadClawExams,
  MH_SCORES,
  TREATMENTS,
  worstMh,
  type ClawExam,
  type Foot,
} from '../lib/clawHealth'
import { fmtDate, localTodayIso } from '../lib/format'
import { matchAnimals, uniqueMatch } from '../lib/pregnancy'
import { speciesOf } from '../lib/species'
import type { Animal } from '../types'

async function loadData(pg: PGlite) {
  const [animals, exams] = await Promise.all([
    pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' order by lauf_nr nulls last, ear_tag"),
    loadClawExams(pg),
  ])
  return { animals: animals.rows, exams }
}

interface Round {
  id: string
  date: string
  examiner: string | null
}
interface Finding {
  foot: Foot | null
  code: string
  grade: string | null
}

const roundKey = (k: string) => `fmis_${k}_claw_round`
function readRound(k: string): Round | null {
  try {
    return JSON.parse(localStorage.getItem(roundKey(k)) ?? 'null') as Round | null
  } catch {
    return null
  }
}
function writeRound(k: string, r: Round | null) {
  try {
    if (r) localStorage.setItem(roundKey(k), JSON.stringify(r))
    else localStorage.removeItem(roundKey(k))
  } catch {
    // nur bis zum Neuladen
  }
}
const label = (a: Animal | undefined) => (a ? `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}${a.name ? ` ${a.name}` : ''}` : 'unbekanntes Tier')
const EMPTY_MH: Record<Foot, number | null> = { VL: null, VR: null, HL: null, HR: null }

/** Klauengesundheit erfassen: Durchgang (Datum, Klauenpfleger/in), dann je Tier Befunde,
 * Lahmheit, geschnitten, Behandlung. Schafe: Moderhinke-Score je Fuss; Rinder: ICAR-Befunde. */
export default function ClawEntry({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const sheep = species === 'sheep'
  const { data } = useQuery(loadData)
  const animals = useMemo(() => data?.animals ?? [], [data])
  const exams = useMemo(() => data?.exams ?? [], [data])
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals])
  const today = localTodayIso()

  const [round, setRoundState] = useState<Round | null>(() => readRound(moduleKey))
  const setRound = (r: Round | null) => {
    setRoundState(r)
    writeRound(moduleKey, r)
  }
  const [startDate, setStartDate] = useState(today)
  const [startExaminer, setStartExaminer] = useState('')
  const examiners = useMemo(() => [...new Set(exams.map((e) => e.examiner).filter((x): x is string => !!x))].slice(0, 5), [exams])
  const rounds = useMemo(() => {
    const m = new Map<string, { id: string; date: string; examiner: string | null; n: number; affected: number }>()
    for (const e of exams) {
      if (!e.round_id) continue
      const r = m.get(e.round_id) ?? { id: e.round_id, date: e.exam_date, examiner: e.examiner, n: 0, affected: 0 }
      r.n++
      if (lesions(e).length > 0 || isLame(e, species)) r.affected++
      m.set(e.round_id, r)
    }
    return [...m.values()]
  }, [exams, species])
  const ofRound = round ? exams.filter((e) => e.round_id === round.id) : []
  const inRound = useMemo(() => new Map(ofRound.map((e) => [e.animal_id, e])), [ofRound])

  // ---- Tier wählen
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [viaReader, setViaReader] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => (picked ? [] : matchAnimals(animals, query)), [animals, query, picked])
  const auto = picked ? null : uniqueMatch(animals, query)
  const animal = picked ? byId.get(picked) : (auto ?? undefined)

  // ---- Befund
  const [mh, setMh] = useState<Record<Foot, number | null>>(EMPTY_MH)
  const [locomotion, setLocomotion] = useState<number | null>(null)
  const [trimmed, setTrimmed] = useState(true)
  const [treatments, setTreatments] = useState<string[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [notes, setNotes] = useState('')
  const [addFoot, setAddFoot] = useState<Foot | null>(null)
  const [addCode, setAddCode] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [after, setAfter] = useState<{ animalId: string; warnings: AnimalWarning[] } | null>(null)

  // Tier gewählt: schon im Durchgang → Eintrag zum Korrigieren laden
  useEffect(() => {
    if (!animal) return
    const e = inRound.get(animal.id)
    if (e) loadExam(e)
    else if (editId) clearForm(false)
    if (auto) input.current?.blur()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animal?.id])

  function loadExam(e: ClawExam) {
    setEditId(e.id)
    const m = { ...EMPTY_MH }
    for (const f of e.findings) if (f.code === 'MH' && f.foot) m[f.foot] = Number(f.grade)
    setMh(m)
    setLocomotion(e.locomotion)
    setTrimmed(e.trimmed)
    setTreatments(e.treatment ? e.treatment.split(', ') : [])
    setFindings(e.findings.filter((f) => f.code !== 'MH').map((f) => ({ foot: f.foot, code: f.code, grade: f.grade })))
    setNotes(e.notes ?? '')
  }
  function clearForm(keepTrim = true) {
    setEditId(null)
    setMh(EMPTY_MH)
    setLocomotion(null)
    if (!keepTrim) setTrimmed(true)
    setTreatments([])
    setFindings([])
    setNotes('')
    setAddFoot(null)
    setAddCode(null)
  }
  function reset() {
    setQuery('')
    setPicked(null)
    setViaReader(false)
    clearForm()
    input.current?.focus()
  }

  const reader = useTagReader({
    moduleKey,
    context: round?.id ?? '',
    duplicate: (read) => {
      const a = matchRead(read, animals)
      const e = a ? inRound.get(a.id) : undefined
      return a && e ? `${label(a)} im Durchgang schon erfasst (${examSummary(e, species)})` : null
    },
    onRead: (read) => {
      const a = matchRead(read, animals)
      if (!a) return { text: `${shortEarTag(read.earTag)}: kein aktives Tier`, tone: 'error' }
      setPicked(a.id)
      setQuery('')
      setViaReader(true)
      return `Gelesen: ${label(a)}`
    },
  })

  async function save() {
    if (!animal || !round || saving) return
    if (sheep && FEET.some((f) => mh[f] == null) && FEET.some((f) => mh[f] != null)) {
      if (!window.confirm('Nicht alle vier Füsse beurteilt. Trotzdem speichern?')) return
    }
    setSaving(true)
    try {
      const prev = editId ? exams.find((e) => e.id === editId) : undefined
      const id = prev?.id ?? crypto.randomUUID()
      const codes = findings.map((f) => f.code)
      const worst = sheep && FEET.some((f) => mh[f] != null) ? Math.max(...FEET.map((f) => mh[f] ?? 0)) : null
      const warnings = clawWarnings(animal.id, { date: round.date, mh: worst, codes, examId: id }, exams, CULL_LIST)
      await inTransaction(db, async (tx) => {
        await upsertRow(tx, 'claw_exams', {
          id,
          animal_id: animal.id,
          exam_date: round.date,
          round_id: round.id,
          examiner: round.examiner,
          locomotion,
          trimmed,
          treatment: treatments.length ? treatments.join(', ') : null,
          notes: notes.trim() || null,
          source: prev?.source ?? (viaReader ? 'reader' : 'manual'),
          recorded_at: prev?.recorded_at ?? new Date().toISOString(),
          created_by: prev?.created_by ?? getCurrentUserEmail(),
          deleted_at: null,
        })
        for (const f of prev?.findings ?? []) await softDeleteRow(tx, 'claw_findings', f.id)
        const rows: Finding[] = [...(sheep ? FEET.filter((f) => mh[f] != null).map((f) => ({ foot: f, code: 'MH', grade: String(mh[f]) })) : []), ...findings]
        for (const f of rows) {
          await upsertRow(tx, 'claw_findings', { id: crypto.randomUUID(), exam_id: id, animal_id: animal.id, foot: f.foot, claw: null, code: f.code, grade: f.grade, zone: null, deleted_at: null })
        }
      })
      setFlash(`${label(animal)} gespeichert${prev ? ' (korrigiert)' : ''}`)
      setTimeout(() => setFlash(null), 3000)
      setAfter(warnings.length ? { animalId: animal.id, warnings: warnings.map((w) => ({ ...w, tone: 'warn' as const })) } : null)
      reset()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function removeExam(e: ClawExam) {
    if (!window.confirm(`Eintrag von ${label(byId.get(e.animal_id))} löschen?`)) return
    await inTransaction(db, async (tx) => {
      for (const f of e.findings) await softDeleteRow(tx, 'claw_findings', f.id)
      await softDeleteRow(tx, 'claw_exams', e.id)
    })
    reset()
  }

  const chip = (on: boolean) => `min-h-11 shrink-0 rounded-full border-2 px-3 text-sm ${on ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-400 bg-white text-gray-800'}`
  const status = useMemo(() => clawStatusByAnimal(exams, species, today), [exams, species, today])

  // ---- Start: neuer Durchgang, frühere Durchgänge, Herdenstand
  if (!round) {
    const active = animals.map((a) => status.get(a.id))
    const examined = active.filter(Boolean).length
    const mhPos = active.filter((s) => (s?.mh ?? 0) > 0).length
    const severe = animals.filter((a) => (status.get(a.id)?.mh ?? 0) >= 3 || status.get(a.id)?.lame)
    const withLesions = active.filter((s) => s && s.lesionCodes.length > 0).length
    return (
      <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
        <h1 className="text-xl font-bold text-gray-900">Klauen</h1>
        <section className="space-y-3 rounded-2xl border-2 border-brand-700 bg-white p-3 shadow-lg">
          <h2 className="text-lg font-bold text-gray-900">Neuer Durchgang</h2>
          <label className="flex items-center justify-between gap-2 text-sm font-medium text-gray-800">
            Datum
            <input type="date" className="min-h-11 rounded-lg border-2 border-gray-400 px-2 text-base" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
          </label>
          <label className="block text-sm font-medium text-gray-800">
            Wer schneidet / beurteilt?
            <input className="mt-1 min-h-12 w-full rounded-lg border-2 border-gray-400 px-3 text-base" value={startExaminer} onChange={(e) => setStartExaminer(e.target.value)} placeholder="z.B. Klauenpfleger Muster" />
          </label>
          {examiners.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {examiners.map((e) => (
                <button key={e} type="button" className={chip(startExaminer.trim() === e)} onClick={() => setStartExaminer(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setRound({ id: crypto.randomUUID(), date: startDate, examiner: startExaminer.trim() || null })
              setTimeout(() => input.current?.focus(), 0)
            }}
            className="min-h-12 w-full rounded-xl bg-brand-700 text-lg font-bold text-white"
          >
            Durchgang starten
          </button>
        </section>

        {rounds.length > 0 && (
          <section className="space-y-1">
            <h2 className="px-1 text-sm font-semibold text-gray-700">Frühere Durchgänge</h2>
            <ul className="divide-y rounded-xl bg-white shadow-sm">
              {rounds.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setRound({ id: r.id, date: r.date, examiner: r.examiner })} className="flex min-h-12 w-full items-center gap-2 px-3 py-1.5 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-900">
                        {fmtDate(r.date)} · {r.examiner ?? 'ohne Angabe'}
                      </span>
                      <span className="block text-xs text-gray-600">
                        {r.n} Tiere, {r.affected} mit Befund
                      </span>
                    </span>
                    <span className="text-sm font-medium text-brand-700">fortsetzen ›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700">Stand der Herde (letzte Beurteilung je Tier)</h2>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg bg-gray-50 p-2">
              <div className="text-xl font-bold">{examined}</div>von {animals.length} beurteilt
            </div>
            {sheep ? (
              <div className="rounded-lg bg-amber-50 p-2">
                <div className="text-xl font-bold text-amber-900">{mhPos}</div>Moderhinke &gt; 0
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 p-2">
                <div className="text-xl font-bold text-amber-900">{withLesions}</div>mit Befund
              </div>
            )}
            <div className="rounded-lg bg-red-50 p-2">
              <div className="text-xl font-bold text-red-800">{severe.length}</div>
              {sheep ? 'Score ≥ 3 oder lahm' : 'lahm'}
            </div>
          </div>
          {severe.length > 0 && (
            <ul className="divide-y text-sm">
              {severe.map((a) => {
                const s = status.get(a.id)!
                return (
                  <li key={a.id} className="flex items-baseline justify-between gap-2 py-1.5">
                    <Link to={`../kuehe/${a.id}`} relative="path" className="font-medium text-brand-700">
                      {label(a)}
                    </Link>
                    <span className="text-right text-xs text-gray-700">
                      {fmtDate(s.last.exam_date)}: {examSummary(s.last, species)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-gray-500">
            {sheep
              ? 'Moderhinke-Score je Fuss 0–5 (Egerton & Roberts, in der Schweiz bis 5 erweitert); je Tier zählt der schwerste Fuss.'
              : 'Befunde nach ICAR-Klauengesundheitsatlas (wie im Schweizer Klauengesundheitsprojekt), Lahmheit 1–5.'}
          </p>
        </section>
      </div>
    )
  }

  // ---- Durchgang
  const codes = codesFor(species)
  const pendingCode = addCode ? codes.find((c) => c.code === addCode) : undefined
  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
      <h1 className="text-xl font-bold text-gray-900">Klauen</h1>
      <section className="overflow-hidden rounded-2xl border-2 border-brand-700 bg-white shadow-lg">
        <div className="flex items-center gap-2 bg-brand-700 px-3 py-2 text-white">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">
              {fmtDate(round.date)} · {round.examiner ?? 'ohne Angabe'}
            </div>
            <div className="text-xs opacity-90">
              Durchgang · {ofRound.length} erfasst · noch offen {animals.length - ofRound.length}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              reader.setOn(false)
              setRound(null)
              reset()
              setAfter(null)
            }}
            className="min-h-11 shrink-0 rounded-lg bg-white px-2.5 text-sm font-semibold text-brand-800"
          >
            Beenden
          </button>
        </div>
        <div className="space-y-2 p-3">
          <TagReaderButton reader={reader} hint="Lesung wählt das Tier" />
          <div className="flex gap-2">
            <input
              ref={input}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="go"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.replace(/[^\d]/g, '').slice(0, 8))
                setPicked(null)
                setViaReader(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && !animal && matches[0] && setPicked(matches[0].id)}
              placeholder="Ohrmarke: letzte 4"
              aria-label="Letzte Ziffern der Ohrmarke"
              className="min-h-14 min-w-0 flex-1 rounded-lg border-2 border-gray-500 px-3 text-2xl tracking-widest focus:border-brand-700 focus:outline-none"
            />
            {(query || picked) && (
              <button type="button" onClick={reset} className="min-h-14 rounded-lg border-2 border-gray-400 bg-white px-3 text-lg" aria-label="Eingabe löschen">
                ✕
              </button>
            )}
          </div>
          {!animal && query && (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border-2 border-gray-300">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setPicked(a.id)} className="flex min-h-12 w-full items-center px-3 text-left">
                    <span className="flex-1">{label(a)}</span>
                    {inRound.has(a.id) && <span className="text-xs text-gray-700">schon erfasst</span>}
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-2 text-sm">Kein aktives Tier mit dieser Ohrmarke.</li>}
            </ul>
          )}

          {animal && (
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-900 px-3 py-2 text-white">
                <div className="text-xl font-bold">{label(animal)}</div>
                <div className="text-sm text-gray-200">
                  {viaReader ? '📡 vom Lesegerät · ' : ''}
                  {editId
                    ? 'in diesem Durchgang schon erfasst — wird korrigiert'
                    : status.get(animal.id)
                      ? `zuletzt ${fmtDate(status.get(animal.id)!.last.exam_date)}: ${examSummary(status.get(animal.id)!.last, species)}`
                      : 'noch keine Klauenbeurteilung'}
                </div>
              </div>

              {sheep && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">Moderhinke-Score je Fuss</span>
                    <button type="button" onClick={() => setMh({ VL: 0, VR: 0, HL: 0, HR: 0 })} className="min-h-10 rounded-lg border-2 border-green-700 px-3 text-sm font-semibold text-green-800">
                      alle gesund
                    </button>
                  </div>
                  {FEET.map((f) => (
                    <div key={f} className="flex items-center gap-1" role="radiogroup" aria-label={`Moderhinke ${FOOT_LABEL[f]}`}>
                      <span className="w-9 shrink-0 text-sm font-bold text-gray-800" title={FOOT_LABEL[f]}>
                        {f}
                      </span>
                      {MH_SCORES.map((s) => (
                        <button
                          key={s.score}
                          type="button"
                          role="radio"
                          aria-checked={mh[f] === s.score}
                          title={s.label}
                          onClick={() => setMh({ ...mh, [f]: mh[f] === s.score ? null : s.score })}
                          className={`min-h-11 flex-1 rounded-lg text-base font-bold ${
                            mh[f] === s.score ? (s.score === 0 ? 'bg-green-700 text-white' : s.score >= 3 ? 'bg-red-700 text-white' : 'bg-amber-500 text-white') : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {s.score}
                        </button>
                      ))}
                    </div>
                  ))}
                  <p className="text-xs text-gray-600">{MH_SCORES.map((s) => `${s.score} ${s.label}`).join(' · ')}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-sm font-semibold text-gray-800">Lahmheit</span>
                {sheep ? (
                  <div className="flex gap-2">
                    {[
                      [0, 'nicht lahm'],
                      [1, 'lahm'],
                    ].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setLocomotion(locomotion === v ? null : (v as number))} className={`min-h-11 flex-1 rounded-lg text-base ${locomotion === v ? 'bg-brand-700 font-semibold text-white' : 'bg-gray-100 text-gray-800'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-5 gap-1">
                    {CATTLE_LOCOMOTION.map((s) => (
                      <button key={s.score} type="button" title={s.label} onClick={() => setLocomotion(locomotion === s.score ? null : s.score)} className={`min-h-12 rounded-lg text-sm ${locomotion === s.score ? 'bg-brand-700 font-semibold text-white' : 'bg-gray-100 text-gray-800'}`}>
                        <span className="block text-base font-bold">{s.score}</span>
                        <span className="block text-[10px] leading-tight">{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <span className="text-sm font-semibold text-gray-800">{sheep ? 'Weitere Befunde' : 'Befunde (ICAR)'}</span>
                {findings.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {findings.map((f, i) => (
                      <li key={i} className="flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-950">
                        <span title={codeLabel(species, f.code)}>
                          {f.code}
                          {f.grade ? ` ${f.grade}` : ''}
                          {f.foot ? ` · ${f.foot}` : ''}
                        </span>
                        <button type="button" onClick={() => setFindings(findings.filter((_, j) => j !== i))} aria-label="Befund entfernen" className="px-1">
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-1" role="radiogroup" aria-label="Fuss für den Befund">
                  {FEET.map((f) => (
                    <button key={f} type="button" role="radio" aria-checked={addFoot === f} onClick={() => setAddFoot(addFoot === f ? null : f)} className={`min-h-10 flex-1 rounded-lg text-sm font-semibold ${addFoot === f ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-800'}`}>
                      {f}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {codes.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      title={c.label}
                      onClick={() => {
                        if (c.grades) setAddCode(addCode === c.code ? null : c.code)
                        else {
                          setFindings([...findings, { foot: addFoot, code: c.code, grade: null }])
                          setAddCode(null)
                        }
                      }}
                      className={`min-h-10 rounded-lg border px-2.5 text-sm ${addCode === c.code ? 'border-brand-700 bg-brand-50 font-semibold' : 'border-gray-300 bg-white'}`}
                    >
                      <b>{c.code}</b> <span className="text-xs text-gray-600">{c.label}</span>
                    </button>
                  ))}
                </div>
                {pendingCode && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-brand-50 p-2">
                    <span className="text-sm">{pendingCode.label}:</span>
                    {pendingCode.grades!.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setFindings([...findings, { foot: addFoot, code: pendingCode.code, grade: g }])
                          setAddCode(null)
                        }}
                        className="min-h-10 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setTrimmed(!trimmed)} className={chip(trimmed)}>
                  ✂ geschnitten
                </button>
                {TREATMENTS[species].map((t) => (
                  <button key={t} type="button" onClick={() => setTreatments(treatments.includes(t) ? treatments.filter((x) => x !== t) : [...treatments, t])} className={chip(treatments.includes(t))}>
                    {t}
                  </button>
                ))}
              </div>
              {treatments.includes('Tierarzt') && (
                <p className="text-xs text-gray-700">
                  Tierarzneimittel mit Absetzfrist bitte im{' '}
                  <Link to="../journal" relative="path" className="text-brand-700 underline">
                    Behandlungsjournal
                  </Link>{' '}
                  erfassen.
                </p>
              )}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bemerkung" className="min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" />
              <div className="flex gap-2">
                {editId && (
                  <button type="button" onClick={() => void removeExam(exams.find((e) => e.id === editId)!)} className="min-h-12 rounded-xl px-3 text-sm text-red-700">
                    Löschen
                  </button>
                )}
                <button type="button" disabled={saving} onClick={() => void save()} className="min-h-12 flex-1 rounded-xl bg-brand-700 text-lg font-bold text-white disabled:opacity-50">
                  {editId ? 'Korrektur speichern' : 'Speichern'}
                </button>
              </div>
            </div>
          )}
          {flash && <p className="rounded-lg bg-green-100 px-3 py-2 text-sm font-semibold text-green-900">✓ {flash}</p>}
          {after && (
            <div>
              <div className="text-sm font-semibold text-gray-900">{label(byId.get(after.animalId))}</div>
              <AnimalWarnings animalIds={[after.animalId]} warnings={after.warnings} />
            </div>
          )}
        </div>
      </section>

      <ul className="divide-y rounded-xl bg-white shadow-sm">
        {ofRound.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => {
                setPicked(e.animal_id)
                setQuery('')
                loadExam(e)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="flex min-h-12 w-full items-center gap-2 px-3 py-1 text-left"
            >
              <span className="min-w-0 flex-1 truncate">{label(byId.get(e.animal_id))}</span>
              {e.source === 'reader' && <span aria-label="vom Lesegerät">📡</span>}
              <span className={`text-right text-sm ${(worstMh(e) ?? 0) >= 3 ? 'font-semibold text-red-700' : 'text-gray-700'}`}>{examSummary(e, species)}</span>
            </button>
          </li>
        ))}
        {ofRound.length === 0 && <li className="px-3 py-3 text-sm text-gray-700">In diesem Durchgang noch nichts erfasst.</li>}
      </ul>
    </div>
  )
}
