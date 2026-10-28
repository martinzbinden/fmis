import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getCurrentUserEmail, getToken } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import { notifyError } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow, upsertRow } from '../db/write'
import { fmtDate, isoDate, localTodayIso, num } from '../lib/format'
import { examiners, fmtDuration, fromWeeks, groupRounds, isYoung, matchAnimals, METHOD_LABEL, RESULT_LABEL, summarize, toWeeks, uniqueMatch, type PregnancyRound } from '../lib/pregnancy'
import { speciesOf, speciesTerms } from '../lib/species'
import type { Animal, DurationUnit, PregnancyCheck, PregnancyMethod, PregnancyResult } from '../types'

async function loadData(pg: PGlite) {
  const [animals, checks] = await Promise.all([
    pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w' order by lauf_nr nulls last, ear_tag"),
    pg.query<PregnancyCheck>('select * from pregnancy_checks where deleted_at is null order by recorded_at desc'),
  ])
  return {
    animals: animals.rows,
    checks: checks.rows.map((c) => ({
      ...c,
      check_date: isoDate(c.check_date)!,
      weeks: num(c.weeks),
      recorded_at: (c.recorded_at as unknown) instanceof Date ? (c.recorded_at as unknown as Date).toISOString() : String(c.recorded_at),
    })),
  }
}

const RESULTS: { key: PregnancyResult; label: string; icon: string; cls: string }[] = [
  { key: 'ja', label: 'trächtig', icon: '✓', cls: 'bg-green-600 text-white active:bg-green-700' },
  { key: 'nein', label: 'leer', icon: '✗', cls: 'bg-gray-700 text-white active:bg-gray-800' },
  { key: 'unsicher', label: 'unsicher', icon: '?', cls: 'bg-amber-500 text-white active:bg-amber-600' },
]
const BADGE: Record<PregnancyResult, string> = { ja: 'bg-green-100 text-green-800', nein: 'bg-gray-200 text-gray-800', unsicher: 'bg-amber-100 text-amber-900' }
const DURATION_CHIPS: Record<DurationUnit, number[]> = { wochen: [4, 6, 8, 10, 12, 14, 16, 18, 20], tage: [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140] }
const UNIT_LABEL: Record<DurationUnit, string> = { wochen: 'Wochen', tage: 'Tage' }
const label = (a: Animal | undefined) => (a ? `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}${a.name ? ` ${a.name}` : ''}` : 'unbekanntes Tier')
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
const METHODS: { key: PregnancyMethod; icon: string }[] = [
  { key: 'auge', icon: '👁' },
  { key: 'farbtupfer', icon: '🎨' },
  { key: 'ultraschall', icon: '🔊' },
]
const roundTitle = (r: Pick<PregnancyRound, 'date' | 'examiner' | 'method'>) =>
  [fmtDate(r.date), r.examiner || 'ohne Angabe', r.method ? METHOD_LABEL[r.method] : null].filter(Boolean).join(' · ')

// Laufender Durchgang und zuletzt gewählte Person/Methode je Gerät (Durchgang = Einträge mit gleicher round_id)
const roundKey = (moduleKey: string) => `fmis_${moduleKey}_pregnancy_round`
const lastKey = (moduleKey: string) => `fmis_${moduleKey}_pregnancy_last`
function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ohne Speicher: Durchgang gilt nur bis zum Neuladen
  }
}

/** Trächtigkeitsuntersuchung schnell erfassen (v.a. am Handy). Zu Beginn eines Durchgangs:
 * wer untersucht, mit welcher Methode. Dann letzte Ziffern der Ohrmarke oder Lesegerät →
 * Ergebnis antippen → gespeichert, nächstes Tier. Liste des Durchgangs darunter, neueste oben. */
export default function PregnancyEntry({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const terms = speciesTerms(moduleKey)
  const { data } = useQuery(loadData)
  const allAnimals = useMemo(() => data?.animals ?? [], [data])
  const byId = useMemo(() => new Map(allAnimals.map((a) => [a.id, a])), [allAnimals])
  const checks = useMemo(() => data?.checks ?? [], [data])
  const rounds = useMemo(() => groupRounds(checks), [checks])
  const knownExaminers = useMemo(() => examiners(checks), [checks])

  // ---- Durchgang
  const [round, setRoundState] = useState<PregnancyRound | null>(() => {
    const r = readJson<PregnancyRound>(roundKey(moduleKey))
    return r ? { ...r, unit: r.unit ?? 'wochen' } : null
  })
  function setRound(r: PregnancyRound | null) {
    setRoundState(r)
    writeJson(roundKey(moduleKey), r)
    if (r) writeJson(lastKey(moduleKey), { examiner: r.examiner, method: r.method, unit: r.unit })
  }
  const last = readJson<{ examiner: string | null; method: PregnancyMethod | null; unit?: DurationUnit }>(lastKey(moduleKey))
  const [startDate, setStartDate] = useState(localTodayIso)
  // Lämmer unter 7 Monaten (am Datum des Durchgangs) gehören nicht in die Untersuchung
  const refDate = round?.date ?? startDate
  const animals = useMemo(() => allAnimals.filter((a) => !isYoung(a, refDate)), [allAnimals, refDate])
  const lambs = allAnimals.length - animals.length
  const [startExaminer, setStartExaminer] = useState(() => last?.examiner ?? '')
  const [startMethod, setStartMethod] = useState<PregnancyMethod | null>(() => last?.method ?? null)
  const [startUnit, setStartUnit] = useState<DurationUnit>(() => last?.unit ?? 'wochen')
  // Vorbelegung aus dem letzten Eintrag, falls dieses Gerät noch nichts gespeichert hat
  useEffect(() => {
    if (last || !rounds.length) return
    setStartExaminer((e) => e || rounds[0].examiner || '')
    setStartMethod((m) => m ?? rounds[0].method)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.length])
  const [editRound, setEditRound] = useState(false)

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [weeks, setWeeks] = useState('')
  const [fromReader, setFromReader] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'info' } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  function showFlash(text: string, tone: 'ok' | 'info' = 'ok') {
    setFlash({ text, tone })
    setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 3000)
  }

  const matches = useMemo(() => (picked ? [] : matchAnimals(animals, query)), [animals, query, picked])
  const auto = useMemo(() => (picked ? null : uniqueMatch(animals, query)), [animals, query, picked])
  const animal = picked ? byId.get(picked) : (auto ?? undefined)
  // Eindeutig gefunden: Tastatur schliessen, damit die Ergebnis-Knöpfe sichtbar sind
  useEffect(() => {
    if (auto) input.current?.blur()
  }, [auto])

  const ofRound = round ? checks.filter((c) => (c.round_id ?? `tag:${c.check_date}`) === round.id) : []
  const sum = summarize(ofRound)
  const checkedIds = new Set(ofRound.map((c) => c.animal_id))
  const open = animals.filter((a) => !checkedIds.has(a.id)).length
  const inRound = animal ? ofRound.find((c) => c.animal_id === animal.id) : undefined
  const previous = animal ? checks.find((c) => c.animal_id === animal.id && c.round_id !== round?.id) : undefined
  const inRoundRef = useRef(new Map<string, PregnancyCheck>())
  inRoundRef.current = new Map(ofRound.map((c) => [c.animal_id, c]))

  function start() {
    if (!startMethod) return
    setRound({ id: crypto.randomUUID(), date: startDate, examiner: startExaminer.trim() || null, method: startMethod, unit: startUnit })
    setEditRound(false)
    setTimeout(() => input.current?.focus(), 0)
  }
  /** Person/Methode eines laufenden Durchgangs ändern: gilt für alle seine Einträge. */
  async function changeRound() {
    if (!round || !startMethod) return
    const next = { ...round, examiner: startExaminer.trim() || null, method: startMethod, unit: startUnit }
    for (const c of ofRound) await upsertRow(db, 'pregnancy_checks', { ...c, round_id: c.round_id ?? round.id, examiner: next.examiner, method: next.method, duration_unit: next.unit })
    setRound(next)
    setEditRound(false)
  }
  function stop() {
    setReaderOn(false)
    setRound(null)
    reset()
  }

  function reset() {
    setQuery('')
    setPicked(null)
    setWeeks('')
    setFromReader(false)
    input.current?.focus()
  }

  async function save(result: PregnancyResult) {
    if (!animal || !round || saving) return
    setSaving(true)
    try {
      const w = toWeeks(weeks, round.unit)
      // Gleiches Tier im gleichen Durchgang: Eintrag korrigieren statt doppelt
      const base = inRound ?? { id: crypto.randomUUID(), recorded_at: new Date().toISOString(), created_by: getCurrentUserEmail(), notes: null }
      await upsertRow(db, 'pregnancy_checks', {
        ...base,
        animal_id: animal.id,
        check_date: round.date,
        result,
        weeks: w ?? inRound?.weeks ?? null,
        source: fromReader ? 'reader' : 'manual',
        round_id: inRound?.round_id ?? round.id,
        examiner: round.examiner,
        method: round.method,
        duration_unit: round.unit,
        deleted_at: null,
      })
      showFlash(`${label(animal)}: ${RESULT_LABEL[result]}${inRound ? ' (korrigiert)' : ''}`)
      reset()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // ---- Lesegerät (APR600) über den Server: solange eingeschaltet, wählt jede Lesung das Tier
  const [readerAvailable, setReaderAvailable] = useState(false)
  const [readerOn, setReaderOn] = useState(false)
  const [readerMsg, setReaderMsg] = useState<string | null>(null)
  useEffect(() => {
    fetch(`${API_URL}/${moduleKey}/reader/status`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((r: { enabled: boolean }) => setReaderAvailable(r.enabled))
      .catch(() => setReaderAvailable(false))
  }, [moduleKey])
  const lastRead = useRef<{ tag: string; at: number } | null>(null)
  useEffect(() => {
    if (!readerOn) return
    const controller = new AbortController()
    setReaderMsg('Verbinde mit dem Lesegerät …')
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/${moduleKey}/reader/scan`, { headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal })
        if (!res.ok || !res.body) {
          const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail
          throw new Error(detail ?? `Lesegerät nicht verfügbar (${res.status})`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            const ev = JSON.parse(line.slice(6)) as { ready?: boolean; error?: string; closed?: boolean; tag?: string; ear_tag?: string; animal_id?: string | null }
            if (ev.ready) setReaderMsg('Lesegerät bereit: Ohrmarke lesen')
            if (ev.error) setReaderMsg(ev.error)
            if (ev.tag) {
              const now = Date.now()
              // Das Gerät meldet dieselbe Marke beim Festhalten mehrmals
              if (lastRead.current && lastRead.current.tag === ev.tag && now - lastRead.current.at < 5000) continue
              lastRead.current = { tag: ev.tag, at: now }
              const done = ev.animal_id ? inRoundRef.current.get(ev.animal_id) : undefined
              if (ev.animal_id && done) {
                // Im gleichen Durchgang schon erfasst: Lesung ignorieren (korrigieren geht über die Liste)
                const a = byIdRef.current.get(ev.animal_id)
                setReaderMsg(`${label(a)}: schon erfasst (${RESULT_LABEL[done.result]}), ignoriert`)
                if (navigator.vibrate) navigator.vibrate([40, 80, 40])
              } else if (ev.animal_id && byIdRef.current.has(ev.animal_id)) {
                setPicked(ev.animal_id)
                setQuery(shortEarTag(ev.ear_tag ?? '').replace(/\D/g, '').slice(-4))
                setFromReader(true)
                setReaderMsg(`Gelesen: ${shortEarTag(ev.ear_tag ?? '')}`)
                if (navigator.vibrate) navigator.vibrate(60)
              } else {
                setReaderMsg(`${shortEarTag(ev.ear_tag ?? ev.tag)}: kein aktives weibliches Tier in der Liste`)
              }
            }
          }
        }
        setReaderOn(false)
      } catch (e) {
        if (!controller.signal.aborted) {
          setReaderMsg(e instanceof Error ? e.message : String(e))
          setReaderOn(false)
        }
      }
    })()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerOn, moduleKey])
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  // ---- Liste: Bearbeiten
  const editing = editId ? checks.find((c) => c.id === editId) : undefined
  const [editWeeks, setEditWeeks] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  function startEdit(c: PregnancyCheck) {
    setEditId(c.id)
    setEditWeeks(fromWeeks(c.weeks, c.duration_unit ?? 'wochen'))
    setConfirmDel(false)
  }
  async function saveEdit(result: PregnancyResult) {
    if (!editing) return
    await upsertRow(db, 'pregnancy_checks', { ...editing, result, weeks: toWeeks(editWeeks, editing.duration_unit ?? 'wochen') })
    setEditId(null)
  }

  const chip = (on: boolean) => `min-h-11 min-w-11 shrink-0 rounded-full border-2 px-3 text-sm ${on ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-400 bg-white text-gray-800'}`

  // ---- Start eines Durchgangs (auch: Person/Methode ändern)
  const roundForm = (
    <section className="space-y-3 rounded-2xl border-2 border-brand-700 bg-white p-3 shadow-lg">
      <h2 className="text-lg font-bold text-gray-900">{editRound ? 'Durchgang ändern' : 'Neuer Durchgang'}</h2>
      {!editRound && (
        <label className="flex items-center justify-between gap-2 text-sm font-medium text-gray-800">
          Datum
          <input type="date" className="min-h-11 rounded-lg border-2 border-gray-400 px-2 text-base" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
        </label>
      )}
      <div className="space-y-1.5">
        <label htmlFor="examiner" className="block text-sm font-medium text-gray-800">
          Wer untersucht?
        </label>
        <input
          id="examiner"
          className="min-h-12 w-full rounded-lg border-2 border-gray-400 px-3 text-base text-gray-900 focus:border-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200"
          value={startExaminer}
          onChange={(e) => setStartExaminer(e.target.value)}
          placeholder="z.B. Tierarzt Muster"
          autoComplete="off"
        />
        {knownExaminers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {knownExaminers.slice(0, 5).map((e) => (
              <button key={e} type="button" className={chip(startExaminer.trim() === e)} onClick={() => setStartExaminer(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-gray-800">Methode</div>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setStartMethod(m.key)}
              className={`min-h-14 rounded-xl border-2 text-base font-semibold ${startMethod === m.key ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-400 bg-white text-gray-800'}`}
            >
              <span className="block text-xl leading-none">{m.icon}</span>
              {METHOD_LABEL[m.key]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-800">Trächtigkeitsdauer in</span>
        <div className="flex rounded-xl border-2 border-gray-400 p-0.5" role="radiogroup" aria-label="Einheit der Trächtigkeitsdauer">
          {(['wochen', 'tage'] as const).map((u) => (
            <button key={u} type="button" role="radio" aria-checked={startUnit === u} onClick={() => setStartUnit(u)} className={`min-h-11 rounded-lg px-4 text-base font-semibold ${startUnit === u ? 'bg-brand-700 text-white' : 'text-gray-800'}`}>
              {UNIT_LABEL[u]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        {editRound && (
          <button type="button" className="min-h-12 rounded-xl border-2 border-gray-400 bg-white px-4 text-base" onClick={() => setEditRound(false)}>
            Abbrechen
          </button>
        )}
        <button
          type="button"
          disabled={!startMethod}
          onClick={() => void (editRound ? changeRound() : start())}
          className="min-h-12 flex-1 rounded-xl bg-brand-700 px-4 text-lg font-bold text-white shadow active:bg-brand-800 disabled:opacity-40"
        >
          {editRound ? `Übernehmen${ofRound.length ? ` (${ofRound.length} Einträge)` : ''}` : 'Durchgang starten'}
        </button>
      </div>
    </section>
  )

  if (!round || editRound) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
        <h1 className="text-xl font-bold text-gray-900">Trächtigkeit</h1>
        {roundForm}
        {!editRound && rounds.length > 0 && (
          <section className="space-y-1">
            <h2 className="px-1 text-sm font-semibold text-gray-700">Frühere Durchgänge</h2>
            <ul className="divide-y rounded-xl bg-white shadow-sm">
              {rounds.slice(0, 12).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-2 px-3 py-1.5 text-left active:bg-gray-50"
                    onClick={() => setRound({ id: r.id, date: r.date, examiner: r.examiner, method: r.method, unit: r.unit })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-gray-900">{roundTitle(r)}</span>
                      <span className="block text-xs text-gray-600">
                        {r.count} {r.count === 1 ? 'Tier' : 'Tiere'}: {r.results.ja} trächtig, {r.results.nein} leer, {r.results.unsicher} unsicher
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-brand-700">fortsetzen ›</span>
                  </button>
                </li>
              ))}
            </ul>
            <CompareLink />
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
      <h1 className="text-xl font-bold text-gray-900">Trächtigkeit</h1>

      <section className="overflow-hidden rounded-2xl border-2 border-brand-700 bg-white shadow-lg">
        <div className="flex items-center gap-2 bg-brand-700 px-3 py-2 text-white">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{roundTitle(round)}</div>
            <div className="text-xs opacity-90">
              Durchgang · {ofRound.length} erfasst · noch offen {open}
            </div>
          </div>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg bg-white/15 px-2.5 text-sm font-medium"
            onClick={() => {
              setStartExaminer(round.examiner ?? '')
              setStartMethod(round.method)
              setStartUnit(round.unit)
              setEditRound(true)
            }}
          >
            Ändern
          </button>
          <button type="button" className="min-h-11 shrink-0 rounded-lg bg-white px-2.5 text-sm font-semibold text-brand-800" onClick={stop}>
            Beenden
          </button>
        </div>

        <div className="space-y-2 p-3">
          {readerAvailable && (
            <div className="flex items-center gap-2 text-sm">
              <button type="button" onClick={() => setReaderOn((o) => !o)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg border-2 px-3 font-semibold ${readerOn ? 'border-green-700 bg-green-700 text-white' : 'border-gray-400 bg-white text-gray-800'}`}>
                📡 Lesegerät {readerOn ? 'ein' : 'aus'}
              </button>
              {readerOn && readerMsg && <span className="font-medium text-gray-800">{readerMsg}</span>}
              {!readerOn && readerMsg && <span className="font-medium text-red-700">{readerMsg}</span>}
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={input}
              autoFocus
              inputMode="numeric"
              enterKeyHint="go"
              autoComplete="off"
              className="min-h-14 min-w-0 flex-1 rounded-lg border-2 border-gray-500 bg-white px-3 text-2xl tracking-widest text-gray-900 placeholder:text-gray-500 focus:border-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-200"
              placeholder="Ohrmarke: letzte 4"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value.replace(/[^\d]/g, '').slice(0, 8))
                setPicked(null)
                setFromReader(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !animal && matches.length) setPicked(matches[0].id)
              }}
              aria-label="Letzte Ziffern der Ohrmarke"
            />
            {(query || picked) && (
              <button type="button" className="min-h-14 rounded-lg border-2 border-gray-400 bg-white px-3 text-lg" onClick={reset} aria-label="Eingabe löschen">
                ✕
              </button>
            )}
          </div>

          {!animal && query && (
            <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border-2 border-gray-300">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3 text-left active:bg-gray-100" onClick={() => setPicked(a.id)}>
                    <span className="flex-1 text-base text-gray-900">{label(a)}</span>
                    {checkedIds.has(a.id) && <span className="text-xs font-medium text-gray-700">schon erfasst</span>}
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-2 text-sm text-gray-700">Kein aktives weibliches Tier mit dieser Ohrmarke.</li>}
            </ul>
          )}

          {animal && (
            <div className="space-y-2">
              <div className="rounded-lg bg-gray-900 px-3 py-2 text-white">
                <div className="text-xl font-bold">{label(animal)}</div>
                <div className="text-sm text-gray-200">
                  {fromReader ? '📡 vom Lesegerät · ' : ''}
                  {inRound
                    ? `in diesem Durchgang schon: ${RESULT_LABEL[inRound.result]}${inRound.weeks != null ? `, ${fmtDuration(inRound.weeks, inRound.duration_unit)}` : ''} — wird korrigiert`
                    : previous
                      ? `zuletzt ${fmtDate(previous.check_date)}: ${RESULT_LABEL[previous.result]}${previous.weeks != null ? `, ${fmtDuration(previous.weeks, previous.duration_unit)}` : ''}${previous.method ? ` (${METHOD_LABEL[previous.method]})` : ''}`
                      : 'noch keine Untersuchung'}
                </div>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label={`Trächtigkeitsdauer in ${UNIT_LABEL[round.unit]} (optional)`}>
                <span className="shrink-0 text-xs font-medium text-gray-800">{UNIT_LABEL[round.unit]}</span>
                {DURATION_CHIPS[round.unit].map((w) => (
                  <button key={w} type="button" className={chip(weeks === String(w))} onClick={() => setWeeks(weeks === String(w) ? '' : String(w))}>
                    {w}
                  </button>
                ))}
                <NumberInput className="min-h-11 w-16 shrink-0 rounded-lg border-2 border-gray-400 px-2 text-base" value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder="…" aria-label={UNIT_LABEL[round.unit]} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {RESULTS.map((r) => (
                  <button key={r.key} type="button" disabled={saving} onClick={() => void save(r.key)} className={`min-h-16 rounded-xl text-lg font-bold shadow disabled:opacity-50 ${r.cls}`}>
                    <span className="block text-2xl leading-none">{r.icon}</span>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {flash && <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${flash.tone === 'ok' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}>{flash.tone === 'ok' ? '✓ ' : ''}{flash.text}</p>}
        </div>
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className={`rounded-full px-2.5 py-1 ${BADGE.ja}`}>trächtig {sum.ja}</span>
        <span className={`rounded-full px-2.5 py-1 ${BADGE.nein}`}>leer {sum.nein}</span>
        <span className={`rounded-full px-2.5 py-1 ${BADGE.unsicher}`}>unsicher {sum.unsicher}</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-gray-700">noch offen {open} von {animals.length} {terms.plural}</span>
        {lambs > 0 && <span className="px-1 py-1 text-gray-500">{lambs} {speciesOf(moduleKey) === 'sheep' ? 'Lämmer' : 'Kälber'} unter 7 Mt. ausgeblendet</span>}
      </div>

      <ul className="divide-y rounded-xl bg-white shadow-sm">
        {ofRound.map((c) => {
          const a = byId.get(c.animal_id)
          if (editId === c.id) {
            return (
              <li key={c.id} className="space-y-2 bg-brand-50 p-3">
                <div className="font-semibold">{label(a)}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">{UNIT_LABEL[c.duration_unit ?? 'wochen']}</span>
                  <NumberInput className="min-h-11 w-20 rounded-lg border border-gray-300 px-2 text-base" value={editWeeks} onChange={(e) => setEditWeeks(e.target.value)} aria-label={UNIT_LABEL[c.duration_unit ?? 'wochen']} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {RESULTS.map((r) => (
                    <button key={r.key} type="button" onClick={() => void saveEdit(r.key)} className={`min-h-12 rounded-lg font-semibold ${r.cls} ${c.result === r.key ? 'ring-4 ring-brand-300' : ''}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between">
                  <button type="button" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm" onClick={() => setEditId(null)}>
                    Abbrechen
                  </button>
                  {confirmDel ? (
                    <button type="button" className="min-h-11 rounded-lg bg-red-600 px-3 text-sm font-medium text-white" onClick={() => void softDeleteRow(db, 'pregnancy_checks', c.id).then(() => setEditId(null))}>
                      Wirklich löschen?
                    </button>
                  ) : (
                    <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-red-700" onClick={() => setConfirmDel(true)}>
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            )
          }
          return (
            <li key={c.id}>
              <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3 py-1 text-left active:bg-gray-50" onClick={() => startEdit(c)}>
                <span className="w-11 shrink-0 text-xs tabular-nums text-gray-600">{hhmm(c.recorded_at)}</span>
                <span className="min-w-0 flex-1 truncate">{label(a)}</span>
                {c.weeks != null && <span className="text-sm tabular-nums text-gray-700">{fmtDuration(c.weeks, c.duration_unit)}</span>}
                {c.source === 'reader' && <span aria-label="vom Lesegerät">📡</span>}
                <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${BADGE[c.result]}`}>{RESULT_LABEL[c.result]}</span>
              </button>
            </li>
          )
        })}
        {ofRound.length === 0 && <li className="px-3 py-3 text-sm text-gray-700">In diesem Durchgang noch nichts erfasst.</li>}
      </ul>
      {ofRound.length > 0 && <p className="px-1 text-xs text-gray-600">Eintrag antippen zum Ändern oder Löschen.</p>}
      {rounds.length > 1 && <CompareLink />}
    </div>
  )
}

function CompareLink() {
  return (
    <Link to="vergleich" relative="path" className="flex min-h-12 items-center justify-between rounded-xl border-2 border-gray-300 bg-white px-3 font-medium text-brand-800 active:bg-gray-50">
      Frühere Beurteilungen vergleichen
      <span aria-hidden>›</span>
    </Link>
  )
}
