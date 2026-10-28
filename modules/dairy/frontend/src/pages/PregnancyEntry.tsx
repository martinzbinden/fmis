import { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getCurrentUserEmail, getToken } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import { notifyError } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow, upsertRow } from '../db/write'
import { fmtDate, isoDate, localTodayIso, num } from '../lib/format'
import { matchAnimals, RESULT_LABEL, summarize, uniqueMatch } from '../lib/pregnancy'
import { speciesTerms } from '../lib/species'
import type { Animal, PregnancyCheck, PregnancyResult } from '../types'

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
const WEEKS = [4, 6, 8, 10, 12, 14, 16, 18, 20]
const label = (a: Animal | undefined) => (a ? `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}${a.name ? ` ${a.name}` : ''}` : 'unbekanntes Tier')
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })

/** Trächtigkeitsuntersuchung schnell erfassen (v.a. am Handy): letzte Ziffern der Ohrmarke
 * oder Lesegerät → Ergebnis antippen → gespeichert, nächstes Tier. Liste darunter, neueste oben. */
export default function PregnancyEntry({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const terms = speciesTerms(moduleKey)
  const { data } = useQuery(loadData)
  const animals = useMemo(() => data?.animals ?? [], [data])
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals])
  const [date, setDate] = useState(localTodayIso)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [weeks, setWeeks] = useState('')
  const [fromReader, setFromReader] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => (picked ? [] : matchAnimals(animals, query)), [animals, query, picked])
  const auto = useMemo(() => (picked ? null : uniqueMatch(animals, query)), [animals, query, picked])
  const animal = picked ? byId.get(picked) : (auto ?? undefined)
  // Eindeutig gefunden: Tastatur schliessen, damit die Ergebnis-Knöpfe sichtbar sind
  useEffect(() => {
    if (auto) input.current?.blur()
  }, [auto])

  const checks = useMemo(() => data?.checks ?? [], [data])
  const ofDay = checks.filter((c) => c.check_date === date)
  const sum = summarize(ofDay)
  const checkedIds = new Set(ofDay.map((c) => c.animal_id))
  const open = animals.filter((a) => !checkedIds.has(a.id)).length
  const todays = animal ? ofDay.find((c) => c.animal_id === animal.id) : undefined
  const previous = animal ? checks.find((c) => c.animal_id === animal.id && c.check_date < date) : undefined

  function reset() {
    setQuery('')
    setPicked(null)
    setWeeks('')
    setFromReader(false)
    input.current?.focus()
  }

  async function save(result: PregnancyResult) {
    if (!animal || saving) return
    setSaving(true)
    try {
      const w = weeks.trim() ? Number(weeks.replace(',', '.')) : null
      // Gleiches Tier am gleichen Tag: Eintrag korrigieren statt doppelt
      const base = todays ?? { id: crypto.randomUUID(), recorded_at: new Date().toISOString(), created_by: getCurrentUserEmail(), notes: null }
      await upsertRow(db, 'pregnancy_checks', {
        ...base,
        animal_id: animal.id,
        check_date: date,
        result,
        weeks: w != null && Number.isFinite(w) ? w : (todays?.weeks ?? null),
        source: fromReader ? 'reader' : 'manual',
        deleted_at: null,
      })
      setFlash(`${label(animal)}: ${RESULT_LABEL[result]}${todays ? ' (korrigiert)' : ''}`)
      setTimeout(() => setFlash(null), 2500)
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
              if (ev.animal_id && byIdRef.current.has(ev.animal_id)) {
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
    setEditWeeks(c.weeks != null ? String(c.weeks) : '')
    setConfirmDel(false)
  }
  async function saveEdit(result: PregnancyResult) {
    if (!editing) return
    const w = editWeeks.trim() ? Number(editWeeks.replace(',', '.')) : null
    await upsertRow(db, 'pregnancy_checks', { ...editing, result, weeks: w != null && Number.isFinite(w) ? w : null })
    setEditId(null)
  }

  const chip = (on: boolean) => `min-h-11 min-w-11 shrink-0 rounded-full border px-3 text-sm ${on ? 'border-brand-600 bg-brand-100 font-semibold text-brand-800' : 'border-gray-300 bg-white text-gray-700'}`

  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Trächtigkeit</h1>
        <input type="date" className="min-h-11 rounded-lg border border-gray-300 px-2 text-base" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum der Untersuchung" />
      </div>

      {readerAvailable && (
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={() => setReaderOn((o) => !o)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg border px-3 font-medium ${readerOn ? 'border-green-700 bg-green-50 text-green-800' : 'border-gray-300 bg-white'}`}>
            📡 Lesegerät {readerOn ? 'ein' : 'aus'}
          </button>
          {readerOn && readerMsg && <span className="text-gray-600">{readerMsg}</span>}
          {!readerOn && readerMsg && <span className="text-red-700">{readerMsg}</span>}
        </div>
      )}

      <section className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
        <div className="flex gap-2">
          <input
            ref={input}
            autoFocus
            inputMode="numeric"
            enterKeyHint="go"
            autoComplete="off"
            className="min-h-14 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-2xl tracking-widest"
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
            <button type="button" className="min-h-14 rounded-lg border border-gray-300 px-3 text-lg" onClick={reset} aria-label="Eingabe löschen">
              ✕
            </button>
          )}
        </div>

        {!animal && query && (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
            {matches.map((a) => (
              <li key={a.id}>
                <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3 text-left active:bg-gray-100" onClick={() => setPicked(a.id)}>
                  <span className="flex-1 text-base">{label(a)}</span>
                  {checkedIds.has(a.id) && <span className="text-xs text-gray-500">schon erfasst</span>}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Kein aktives weibliches Tier mit dieser Ohrmarke.</li>}
          </ul>
        )}

        {animal && (
          <div className="space-y-2">
            <div className="rounded-lg bg-brand-50 px-3 py-2">
              <div className="text-lg font-bold text-gray-900">{label(animal)}</div>
              <div className="text-xs text-gray-600">
                {fromReader ? '📡 vom Lesegerät · ' : ''}
                {todays ? `heute schon: ${RESULT_LABEL[todays.result]}${todays.weeks != null ? `, ${todays.weeks} Wo.` : ''} — wird korrigiert` : previous ? `zuletzt ${fmtDate(previous.check_date)}: ${RESULT_LABEL[previous.result]}` : `noch keine Untersuchung`}
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label="Trächtigkeitsdauer in Wochen (optional)">
              <span className="shrink-0 text-xs text-gray-600">Wochen</span>
              {WEEKS.map((w) => (
                <button key={w} type="button" className={chip(weeks === String(w))} onClick={() => setWeeks(weeks === String(w) ? '' : String(w))}>
                  {w}
                </button>
              ))}
              <NumberInput className="min-h-11 w-16 shrink-0 rounded-lg border border-gray-300 px-2 text-base" value={weeks} onChange={(e) => setWeeks(e.target.value)} placeholder="…" aria-label="Wochen" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {RESULTS.map((r) => (
                <button key={r.key} type="button" disabled={saving} onClick={() => void save(r.key)} className={`min-h-16 rounded-xl text-lg font-bold shadow-sm disabled:opacity-50 ${r.cls}`}>
                  <span className="block text-2xl leading-none">{r.icon}</span>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {flash && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-800">✓ {flash}</p>}
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className={`rounded-full px-2.5 py-1 ${BADGE.ja}`}>trächtig {sum.ja}</span>
        <span className={`rounded-full px-2.5 py-1 ${BADGE.nein}`}>leer {sum.nein}</span>
        <span className={`rounded-full px-2.5 py-1 ${BADGE.unsicher}`}>unsicher {sum.unsicher}</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">noch offen {open} von {animals.length} {terms.plural}</span>
      </div>

      <ul className="divide-y rounded-xl bg-white shadow-sm">
        {ofDay.map((c) => {
          const a = byId.get(c.animal_id)
          if (editId === c.id) {
            return (
              <li key={c.id} className="space-y-2 bg-brand-50 p-3">
                <div className="font-semibold">{label(a)}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Wochen</span>
                  <NumberInput className="min-h-11 w-20 rounded-lg border border-gray-300 px-2 text-base" value={editWeeks} onChange={(e) => setEditWeeks(e.target.value)} aria-label="Wochen" />
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
                <span className="w-11 shrink-0 text-xs tabular-nums text-gray-500">{hhmm(c.recorded_at)}</span>
                <span className="min-w-0 flex-1 truncate">{label(a)}</span>
                {c.weeks != null && <span className="text-sm tabular-nums text-gray-600">{c.weeks} Wo.</span>}
                {c.source === 'reader' && <span aria-label="vom Lesegerät">📡</span>}
                <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${BADGE[c.result]}`}>{RESULT_LABEL[c.result]}</span>
              </button>
            </li>
          )
        })}
        {ofDay.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">Am {fmtDate(date)} noch nichts erfasst.</li>}
      </ul>
      {ofDay.length > 0 && <p className="px-1 text-xs text-gray-500">Eintrag antippen zum Ändern oder Löschen.</p>}
    </div>
  )
}
