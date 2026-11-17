import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { daysBetween, fmtDate, isoDate, num, todayIso } from '../lib/format'
import { lactationDayAt } from '../lib/lactationDay'
import { isDrySql, lastCalvingSql } from '../lib/dryOff'
import { YogurtPaper, YogurtPrintPortal, YOGURT_PRINT_CSS } from './YogurtPrint'
import { CRITERION_LABEL, exclusion, FRESH_DAYS, suggestYogurt, yogurtMix, type YogurtCow, type YogurtCriterion, type YogurtOptions } from '../lib/yogurtPlan'
import { notSupersededSql } from '../lib/journal'
import { MILK_UNTIL_SQL } from '../lib/treatments'
import { useDb } from '@fmis/core/DbContext'
import { softDeleteRow } from '../db/write'
import { batchPreview, loadRun, loadYogurtBatches, saveRun, saveYogurtBatch, toggleMilked, type YogurtRun } from '../lib/yogurtBatch'

/** Letzte Wägung je aktivem Tier; fehlt dort die Laboranalyse, die Gehalte
 * der letzten analysierten Wägung. */
async function loadCows(pg: PGlite): Promise<YogurtCow[]> {
  const [latest, analysed] = await Promise.all([
    pg.query<Record<string, unknown>>(
      `select distinct on (a.id) a.id as animal_id, a.ear_tag, a.name, a.lauf_nr, t.test_date, t.milk_kg, t.fat_pct, t.protein_pct, t.cell_count,
              (${isDrySql('a')}) as dry, ${lastCalvingSql('a')} as calving_date,
              (select max(${MILK_UNTIL_SQL}) from animal_journal j
                where j.animal_id = a.id and j.deleted_at is null and ${notSupersededSql('j')}) as withdrawal_until
       from animals a join milk_tests t on t.animal_id = a.id and t.deleted_at is null
       where a.deleted_at is null and a.status = 'aktiv'
       order by a.id, t.test_date desc`,
    ),
    pg.query<Record<string, unknown>>(
      `select distinct on (t.animal_id) t.animal_id, t.test_date, t.fat_pct, t.protein_pct, t.cell_count
       from milk_tests t where t.deleted_at is null and t.protein_pct is not null
       order by t.animal_id, t.test_date desc`,
    ),
  ])
  const lab = new Map(analysed.rows.map((r) => [String(r.animal_id), r]))
  return latest.rows.map((r) => {
    const hasLab = num(r.protein_pct) != null
    const l = hasLab ? null : lab.get(String(r.animal_id))
    const name = r.name ? ` ${r.name}` : ''
    return {
      animal_id: String(r.animal_id),
      label: `${r.lauf_nr ?? String(r.ear_tag).slice(-4)}${name}`,
      ear_tag: String(r.ear_tag),
      test_date: isoDate(r.test_date)!,
      milk_kg: num(r.milk_kg) ?? 0,
      fat_pct: num(hasLab ? r.fat_pct : l?.fat_pct),
      protein_pct: num(hasLab ? r.protein_pct : l?.protein_pct),
      cell_count: num(r.cell_count) ?? num(l?.cell_count),
      analysis_date: l ? isoDate(l.test_date) : null,
      dry: Boolean(r.dry),
      withdrawal_until: isoDate(r.withdrawal_until),
      calving_date: isoDate(r.calving_date),
    }
  })
}

const f1 = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Zellzahl ist in 1000/ml gespeichert (Milchprüfung)
const scc = (v: number | null) => (v == null ? '–' : `${Math.round(v).toLocaleString('de-CH')}'000`)
const STORAGE_KEY = 'dairy_yogurt_planner_v2'
const short = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`

function loadSettings(): YogurtOptions {
  const d: YogurtOptions = { targetKg: 100, factor: 1, criterion: 'eiweiss', maxCellCount: 250 }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<YogurtOptions>) }
  } catch {
    return d
  }
}

/** Höhe der App-Kopfzeile: darunter bleiben Summen und Spaltenköpfe stehen. */
function useHeaderHeight(): number {
  const [h, setH] = useState(56)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-app-header]')
    if (!el) return
    const update = () => setH(Math.round(el.getBoundingClientRect().height))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return h
}

/** Antippen = an-/abwählen, lange drücken (oder Rechtsklick, Taste G) = gemolken. Wer scrollt, löst nichts aus. */
function usePress(onTap: () => void, onLong: () => void) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const long = () => {
    clear()
    fired.current = true
    navigator.vibrate?.(40)
    onLong()
  }
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false
      if (e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(long, 500)
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: MouseEvent) => {
      // Android meldet den langen Druck auch als Kontextmenü: nur einmal auslösen
      e.preventDefault()
      if (!fired.current) long()
    },
    onClick: () => {
      if (fired.current) fired.current = false
      else onTap()
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onTap()
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        onLong()
      }
    },
  }
}

// Spalten: Haken · Kuh · kg · Eiweiss · Fett · Zellen (Kopf und Zeilen gleich)
const COLS = 'grid grid-cols-[1.75rem_minmax(0,1fr)_2.4rem_2.5rem_2.5rem_2.6rem] items-center gap-x-1'

function CowRow({
  c,
  reason,
  blocked,
  on,
  milked,
  extra,
  factor,
  maxCells,
  today,
  onTap,
  onLong,
}: {
  c: YogurtCow
  reason: string | null
  blocked: boolean
  on: boolean
  milked: boolean
  extra: boolean
  factor: number
  maxCells: number | null
  today: string
  onTap: () => void
  onLong: () => void
}) {
  const press = usePress(onTap, onLong)
  const dim = lactationDayAt(c.calving_date, today)
  const age = daysBetween(c.test_date, today)
  return (
    <div
      role="checkbox"
      aria-checked={on}
      aria-disabled={blocked || undefined}
      aria-keyshortcuts="G"
      aria-label={`${c.label}${milked ? ', gemolken' : ''}`}
      tabIndex={blocked ? -1 : 0}
      {...(blocked ? {} : press)}
      className={`${COLS} min-h-11 select-none border-b px-1.5 py-1 [-webkit-touch-callout:none] last:border-0 ${
        blocked ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      } ${milked ? 'bg-emerald-50' : on ? 'bg-brand-50' : ''}`}
    >
      <span aria-hidden className="flex justify-center">
        {milked ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
        ) : (
          <span className={`h-5 w-5 rounded border-2 ${on ? 'border-brand-700 bg-brand-700' : 'border-gray-400 bg-white'} flex items-center justify-center text-xs font-bold text-white`}>
            {on ? '✓' : ''}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight">
          {c.label}
          {extra && <span className="ml-1 text-xs font-normal text-amber-700">dazu</span>}
        </span>
        <span className="block truncate text-[11px] leading-tight text-gray-500">
          {dim != null && <>Tag {dim} · </>}
          <span className={age > 25 ? 'text-amber-700' : ''}>
            gew. {short(c.test_date)} ({age} T.)
          </span>
          {c.analysis_date ? ` · Geh. ${short(c.analysis_date)}` : ''}
          {reason && <span className={blocked ? ' text-red-700' : ' text-amber-700'}> · {reason}</span>}
        </span>
      </span>
      <span className="text-right text-sm tabular-nums">{f1(c.milk_kg * factor)}</span>
      <span className="text-right text-sm tabular-nums">{c.protein_pct != null ? f2(c.protein_pct) : '–'}</span>
      <span className="text-right text-sm tabular-nums">{c.fat_pct != null ? f2(c.fat_pct) : '–'}</span>
      <span className={`text-right text-sm tabular-nums ${maxCells != null && (c.cell_count ?? 0) > maxCells ? 'text-red-700' : ''}`}>
        {c.cell_count != null ? Math.round(c.cell_count).toLocaleString('de-CH') : '–'}
      </span>
    </div>
  )
}

/** Joghurt-Planer: Milchmenge eingeben → geeignetste Kühe vorgeschlagen (nach Eiweiss, Fett+Eiweiss oder Zellzahl),
 * von Hand an-/abwählbar; Gehalte der Mischmilch laufend gerechnet. Am Melkstand: langer Druck = gemolken (auch eine
 * nicht vorgeschlagene Kuh), am Schluss «Vorgang beenden» speichert, was tatsächlich in die Joghurt-Milch kam. Fürs
 * Handy kompakt: Summen und Spaltenköpfe bleiben beim Scrollen stehen, Drucken steht oben. */
export default function YogurtPlanner() {
  const db = useDb()
  const { data, loading } = useQuery(loadCows, [])
  const { data: batches } = useQuery((pg) => loadYogurtBatches(pg), [])
  const [opts, setOptsState] = useState<YogurtOptions>(loadSettings)
  const setOpts = (patch: Partial<YogurtOptions>) => {
    const next = { ...opts, ...patch }
    setOptsState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // nur im Speicher
    }
  }
  const [run, setRunState] = useState<YogurtRun | null>(loadRun)
  const setRun = (r: YogurtRun | null) => {
    setRunState(r)
    saveRun(r)
  }
  const [settingsOpen, setSettingsOpen] = useState(() => !loadRun())
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const headerH = useHeaderHeight()
  const snapRef = useRef<HTMLDivElement>(null)
  const today = todayIso()
  const cows = data ?? []

  const picked = useMemo(() => (run ? new Set(run.picked) : null), [run])
  const milked = useMemo(() => new Set(run?.milked ?? []), [run])
  const suggested = useMemo(() => new Set(run?.suggested ?? []), [run])

  const rows = useMemo(
    () =>
      cows
        .map((c) => ({ c, ex: exclusion(c, opts, today) }))
        .sort(
          (a, b) =>
            Number(a.ex?.blocked ?? false) - Number(b.ex?.blocked ?? false) ||
            Number(!!a.ex) - Number(!!b.ex) ||
            (opts.criterion === 'zellzahl'
              ? (a.c.cell_count ?? Infinity) - (b.c.cell_count ?? Infinity)
              : (b.c.protein_pct ?? 0) + (opts.criterion === 'fett_eiweiss' ? (b.c.fat_pct ?? 0) : 0) - (a.c.protein_pct ?? 0) - (opts.criterion === 'fett_eiweiss' ? (a.c.fat_pct ?? 0) : 0)),
        ),
    [cows, opts, today],
  )

  /** Ansicht einschnappen: Summen und Liste füllen den Bildschirm. */
  const snap = () =>
    requestAnimationFrame(() => {
      const el = snapRef.current
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerH, behavior: 'smooth' })
    })
  // Laufender Vorgang beim Öffnen: gleich zur Liste
  const snapped = useRef(false)
  useEffect(() => {
    if (data && run && !snapped.current) {
      snapped.current = true
      snap()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function suggest() {
    if (run?.milked.length && !window.confirm(`${run.milked.length} Kühe sind schon als gemolken markiert. Neu vorschlagen und die Markierungen verwerfen?`)) return
    const ids = suggestYogurt(cows, opts, today)
    setRun({ date: today, picked: ids, suggested: ids, milked: [] })
    setSettingsOpen(false)
    setDone(null)
    snap()
  }
  const toggle = (id: string) => {
    const base = run ?? { date: today, picked: [], suggested: [], milked: [] }
    const has = base.picked.includes(id)
    setRun({ ...base, picked: has ? base.picked.filter((p) => p !== id) : [...base.picked, id], milked: has ? base.milked.filter((m) => m !== id) : base.milked })
  }
  const markMilked = (id: string) => {
    const base = run ?? { date: today, picked: [], suggested: [], milked: [] }
    setRun({ ...base, ...toggleMilked(base, id) })
  }

  const selected = cows.filter((c) => picked?.has(c.animal_id))
  const mix = yogurtMix(selected, opts.factor)
  const missing = opts.targetKg - mix.milkKg
  const manual = run != null && (selected.length !== suggested.size || selected.some((c) => !suggested.has(c.animal_id)))
  const milkedCows = selected.filter((c) => milked.has(c.animal_id))
  const milkedKg = milkedCows.reduce((s, c) => s + c.milk_kg * opts.factor, 0)
  const preview = run ? batchPreview(cows, run, opts.factor) : null

  // Für die Druckansicht: abgelieferte Milch (ohne gesperrte) und gesperrte
  const delivered = rows.filter((r) => !r.ex?.blocked).map((r) => r.c)
  const blocked = rows.filter((r) => r.ex?.blocked).map((r) => r.c)

  async function finish() {
    if (!run || !preview || preview.cows.length === 0) return
    setSaving(true)
    try {
      await saveYogurtBatch(db, preview, run, opts, today)
      setDone(`Gespeichert: ${fmtDate(today)} · ${f1(preview.mix.milkKg)} kg aus ${preview.cows.length} Kühen`)
      setRun(null)
      setConfirming(false)
      setSettingsOpen(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <p className="text-sm text-gray-500">Lädt…</p>

  const settingsLine = `${opts.targetKg.toLocaleString('de-CH')} kg · ${opts.factor === 1 ? 'Tagesmilch' : '1 Gemelk'} · ${CRITERION_LABEL[opts.criterion]}${opts.maxCellCount != null ? ` · Zellen ≤ ${opts.maxCellCount}` : ''}`

  return (
    <div className="space-y-2">
      {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">✓ {done}</p>}

      {/* Einstellungen: während eines Vorgangs auf eine Zeile eingeklappt, Drucken gleich daneben */}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-lg bg-white px-3 text-left text-sm shadow-sm"
        >
          <span aria-hidden>⚙</span>
          <span className="truncate text-gray-700">{settingsLine}</span>
          <span aria-hidden className="ml-auto text-gray-500">
            {settingsOpen ? '▴' : '▾'}
          </span>
        </button>
        {selected.length > 0 && (
          <button type="button" onClick={() => window.print()} className="link-btn min-h-11 shrink-0 rounded-lg bg-white px-3 text-sm font-medium text-gray-800 shadow-sm">
            🖨 Melkliste
          </button>
        )}
      </div>
      {settingsOpen && (
        <div className="space-y-2 rounded-lg bg-white p-2 shadow-sm">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">Milchmenge kg</span>
              <input
                inputMode="decimal"
                value={opts.targetKg || ''}
                onChange={(e) => setOpts({ targetKg: Number(e.target.value.replace(',', '.')) || 0 })}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-base font-semibold"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">aus</span>
              <select value={opts.factor} onChange={(e) => setOpts({ factor: Number(e.target.value) })} className="w-full rounded border border-gray-300 px-2 py-1.5">
                <option value={1}>Tagesmilch (2 Gemelke)</option>
                <option value={0.5}>1 Gemelk</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">Kühe mit</span>
              <select value={opts.criterion} onChange={(e) => setOpts({ criterion: e.target.value as YogurtCriterion })} className="w-full rounded border border-gray-300 px-2 py-1.5">
                {(Object.keys(CRITERION_LABEL) as YogurtCriterion[]).map((k) => (
                  <option key={k} value={k}>
                    {CRITERION_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">Zellzahl höchstens (1000/ml)</span>
              <input
                inputMode="numeric"
                value={opts.maxCellCount ?? ''}
                placeholder="egal"
                onChange={(e) => setOpts({ maxCellCount: e.target.value.trim() ? Number(e.target.value) || null : null })}
                className="w-full rounded border border-gray-300 px-2 py-1.5"
              />
            </label>
          </div>
          <button type="button" onClick={suggest} className="min-h-11 w-full rounded-lg bg-brand-700 text-sm font-semibold text-white active:bg-brand-800">
            Geeignetste Kühe für {opts.targetKg.toLocaleString('de-CH')} kg vorschlagen
          </button>
        </div>
      )}

      {/* Summen + Spaltenköpfe: bleiben unter der Kopfzeile stehen */}
      <div>
        <div ref={snapRef} className="sticky z-10 -mx-4 bg-gray-50 px-4 pt-1" style={{ top: headerH }}>
          {run && (
            <div className={`rounded-t-lg px-2 pb-1 pt-1.5 ${missing > 0 ? 'bg-amber-50 text-amber-900' : 'bg-brand-50 text-brand-900'}`} aria-live="polite">
              <div className="grid grid-cols-4 gap-1 text-center leading-tight">
                <div>
                  <div className="text-[11px] opacity-70">Milch · {mix.n} Kühe</div>
                  <div className="text-base font-bold tabular-nums">{f1(mix.milkKg)} kg</div>
                </div>
                <div>
                  <div className="text-[11px] opacity-70">Eiweiss</div>
                  <div className="text-base font-bold tabular-nums">{mix.proteinPct != null ? `${f2(mix.proteinPct)} %` : '–'}</div>
                </div>
                <div>
                  <div className="text-[11px] opacity-70">Fett</div>
                  <div className="text-base font-bold tabular-nums">{mix.fatPct != null ? `${f2(mix.fatPct)} %` : '–'}</div>
                </div>
                <div>
                  <div className="text-[11px] opacity-70">Zellzahl</div>
                  <div className="text-base font-bold tabular-nums">{scc(mix.cellCount)}</div>
                </div>
              </div>
              <p className="mt-0.5 truncate text-center text-[11px]">
                {missing > 0 ? `Es fehlen ${f1(missing)} kg` : `Ziel erreicht (+${f1(-missing)} kg)`}
                {manual ? ' · von Hand' : ''}
                {milked.size > 0 ? ` · gemolken ${milkedCows.length}/${selected.length} = ${f1(milkedKg)} kg` : ''}
                {mix.unknownKg > 0 ? ` · ${f1(mix.unknownKg)} kg ohne Analyse` : ''}
              </p>
            </div>
          )}
          <div className={`${COLS} border-b bg-white px-1.5 py-1 text-[11px] text-gray-500 ${run ? '' : 'rounded-t-lg'}`} aria-hidden>
            <span />
            <span>Kuh</span>
            <span className="text-right">kg</span>
            <span className="text-right">Eiw.%</span>
            <span className="text-right">Fett%</span>
            <span className="text-right">Zellen</span>
          </div>
        </div>

        <div className="rounded-b-lg bg-white shadow-sm" role="group" aria-label="Kühe für die Joghurt-Milch">
          {rows.map(({ c, ex }) => (
            <CowRow
              key={c.animal_id}
              c={c}
              reason={ex?.reason ?? null}
              blocked={!!ex?.blocked}
              on={picked?.has(c.animal_id) ?? false}
              milked={milked.has(c.animal_id)}
              extra={run != null && milked.has(c.animal_id) && !suggested.has(c.animal_id)}
              factor={opts.factor}
              maxCells={opts.maxCellCount}
              today={today}
              onTap={() => toggle(c.animal_id)}
              onLong={() => markMilked(c.animal_id)}
            />
          ))}
        </div>
      </div>

      {run && preview && (
        <div className="space-y-2 pt-1">
          {!confirming ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={preview.cows.length === 0}
                className="min-h-12 flex-1 rounded-lg bg-emerald-700 text-sm font-semibold text-white active:bg-emerald-800 disabled:opacity-40"
              >
                ✓ Vorgang beenden
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!milked.size || window.confirm('Vorgang verwerfen? Die Markierungen «gemolken» gehen verloren.')) {
                    setRun(null)
                    setSettingsOpen(true)
                  }
                }}
                className="min-h-12 rounded-lg bg-white px-3 text-sm text-gray-700 shadow-sm"
              >
                Verwerfen
              </button>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-emerald-700 bg-white p-3 text-sm" role="dialog" aria-label="Vorgang beenden">
              <p className="font-semibold">
                Joghurt-Milch {fmtDate(today)}: {f1(preview.mix.milkKg)} kg aus {preview.cows.length} Kühen
              </p>
              <p className="text-gray-700">
                Eiweiss {preview.mix.proteinPct != null ? `${f2(preview.mix.proteinPct)} %` : '–'} · Fett {preview.mix.fatPct != null ? `${f2(preview.mix.fatPct)} %` : '–'} · Zellen {scc(preview.mix.cellCount)}
              </p>
              {preview.assumedAll && <p className="mt-1 text-amber-800">Keine Kuh als gemolken markiert: es gilt die ganze Auswahl.</p>}
              {preview.extra.length > 0 && <p className="mt-1 text-amber-800">Dazugemolken (nicht vorgeschlagen): {preview.extra.map((c) => c.label).join(', ')}</p>}
              {preview.notMilked.length > 0 && <p className="mt-1 text-gray-600">Ausgewählt, aber nicht gemolken (nicht dabei): {preview.notMilked.map((c) => c.label).join(', ')}</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={finish} disabled={saving} className="min-h-11 flex-1 rounded-lg bg-emerald-700 font-semibold text-white disabled:opacity-50">
                  {saving ? 'Speichert…' : 'Bestätigen und speichern'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-lg border border-gray-300 px-3">
                  Zurück
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <>
          <YogurtPrintPortal selected={selected} delivered={delivered} blocked={blocked} opts={opts} />
          <details className="rounded-lg bg-white shadow-sm">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">Vorschau Melkliste</summary>
            <div className="overflow-x-auto bg-gray-200 p-2">
              <style>{YOGURT_PRINT_CSS}</style>
              <YogurtPaper selected={selected} delivered={delivered} blocked={blocked} opts={opts} />
            </div>
          </details>
        </>
      )}

      {batches && batches.length > 0 && (
        <details className="rounded-lg bg-white shadow-sm">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700">Erledigte Joghurt-Milch ({batches.length})</summary>
          <ul className="divide-y text-sm">
            {batches.map((b) => (
              <li key={b.id} className="px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {fmtDate(b.batch_date)} · {b.milk_kg != null ? `${f1(b.milk_kg)} kg` : '–'} · {b.cows.length} Kühe
                  </span>
                  <button
                    type="button"
                    onClick={() => window.confirm(`Joghurt-Milch vom ${fmtDate(b.batch_date)} löschen?`) && softDeleteRow(db, 'yogurt_batches', b.id)}
                    className="min-h-9 px-2 text-xs text-gray-500"
                  >
                    Löschen
                  </button>
                </div>
                <div className="text-xs text-gray-600">
                  Eiweiss {b.protein_pct != null ? `${f2(b.protein_pct)} %` : '–'} · Fett {b.fat_pct != null ? `${f2(b.fat_pct)} %` : '–'} · Zellen {scc(b.cell_count)}
                </div>
                <div className="text-xs text-gray-500">{b.cows.map((c) => `${c.label}${c.suggested ? '' : ' (dazu)'}`).join(', ')}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-gray-500">
        Antippen = an-/abwählen, lange drücken = gemolken (auch eine nicht vorgeschlagene Kuh; am PC Rechtsklick oder Taste G). «Vorgang beenden»
        speichert die gemolkenen Kühe, ohne Markierung die ganze Auswahl. Milchmenge und Gehalte aus der letzten Milchwägung je Kuh (ohne
        Laboranalyse: Gehalte der letzten analysierten), mengengewichtet; Zellen in 1000/ml. Trockene Kühe, Kühe mit offener Milch-Absetzfrist
        und frisch gekalbte Kühe (die ersten {FRESH_DAYS} Laktationstage, Kolostrum) sind gesperrt. Kühe ohne Wägung seit der Abkalbung werden
        nicht vorgeschlagen (von Hand wählbar, die Menge ist dann veraltet).
      </p>
    </div>
  )
}
