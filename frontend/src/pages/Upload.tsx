import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthUser } from '@fmis/core/AuthContext'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { expandUploads, type ImportClaim, type ImportStatus, type UploadFile } from '@fmis/core/upload'
import PasteImport from './PasteImport'

interface Run {
  id: string
  batchId: string
  mod: ModuleDescriptor
  claim: ImportClaim
  included: boolean
  status: ImportStatus
  startedAt?: number
  finishedAt?: number
}

interface Batch {
  id: string
  createdAt: number
  names: string[]
  /** Fortschritt der Erkennung, null wenn fertig. */
  analyzing: { step: string; fraction: number } | null
  analyzedAt?: number
  unknown: { path: string; reason: string }[]
  error?: string
  /** "Importe starten" gedrückt. */
  started: boolean
}

/** Alle Dateien einer Auswahl den Modulen zuordnen (core/frontend/src/upload.ts).
 * Jedes Modul sieht nur noch, was die vorherigen nicht übernommen haben. */
async function analyze(
  picked: File[],
  importers: ModuleDescriptor[],
  onProgress: (step: string, fraction: number) => void,
): Promise<{ assigned: { mod: ModuleDescriptor; claim: ImportClaim }[]; unknown: { path: string; reason: string }[] }> {
  const { files, ignored } = await expandUploads(picked, (count, path) =>
    onProgress(`Auspacken: ${count} Dateien · ${path.split('/').pop()}`, 0.3 * Math.min(1, count / Math.max(picked.length, 20))),
  )
  let rest: UploadFile[] = files
  const reasons = new Map<string, string>()
  const assigned: { mod: ModuleDescriptor; claim: ImportClaim }[] = []
  for (const [i, mod] of importers.entries()) {
    onProgress(`Erkennen: ${mod.title}`, 0.3 + (0.7 * i) / importers.length)
    try {
      const { claims, rejected } = await mod.importer!.detect(rest)
      for (const r of rejected ?? []) if (!reasons.has(r.file.path)) reasons.set(r.file.path, r.reason)
      const taken = new Set(claims.flatMap((c) => c.files.map((f) => f.path)))
      rest = rest.filter((f) => !taken.has(f.path))
      for (const claim of claims) assigned.push({ mod, claim })
    } catch (err) {
      console.error(`Erkennung ${mod.key} fehlgeschlagen`, err)
    }
  }
  const unknown = [...ignored, ...rest.map((f) => ({ path: f.path, reason: reasons.get(f.path) ?? 'Format nicht bekannt' }))]
  return { assigned, unknown }
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })

function ProgressBar({ fraction, tone = 'brand' }: { fraction: number; tone?: 'brand' | 'amber' | 'red' | 'green' }) {
  const color = { brand: 'bg-brand-600', amber: 'bg-amber-500', red: 'bg-red-500', green: 'bg-green-600' }[tone]
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full ${color} transition-[width] duration-300`} style={{ width: `${Math.round(fraction * 100)}%` }} />
    </div>
  )
}

const PHASE_LABEL: Record<ImportStatus['phase'], string> = {
  queued: 'wartet',
  running: 'läuft',
  input: 'Rückfrage',
  done: 'fertig',
  error: 'Fehler',
}

const PHASE_CHIP: Record<ImportStatus['phase'], string> = {
  queued: 'bg-gray-100 text-gray-600',
  running: 'bg-brand-100 text-brand-800',
  input: 'bg-amber-100 text-amber-900',
  done: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
}

/** Eine Upload-Seite für alle Module: Dateien oder ZIPs ablegen, die
 * Zuordnung (Modul, Herde/Tierart, Betrieb) passiert automatisch. Was kein
 * Modul kennt, wird gemeldet — neue Formate müssen zuerst im Code angelernt
 * werden (ModuleImporter eines Moduls). Jeder Upload bleibt als eigener Block
 * stehen; die Importe laufen nacheinander (Warteschlange), mit Fortschritt. */
export default function Upload({ modules }: { modules: ModuleDescriptor[] }) {
  const user = useAuthUser()
  const importers = modules.filter((m) => m.importer && user?.permissions.includes(m.importer.permission))
  const withoutRight = modules.filter((m) => m.importer && user && !user.permissions.includes(m.importer.permission))
  const [dragging, setDragging] = useState(false)
  const [batches, setBatches] = useState<Batch[]>([])
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [queue, setQueue] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  const seq = useRef(0)

  const updateBatch = (id: string, patch: Partial<Batch>) => setBatches((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const setStatus = useCallback((id: string, status: ImportStatus) => {
    setRuns((rs) => {
      const run = rs[id]
      if (!run) return rs
      const finished = status.phase === 'done' || status.phase === 'error'
      return { ...rs, [id]: { ...run, status, finishedAt: finished ? (run.finishedAt ?? Date.now()) : undefined } }
    })
  }, [])
  // Je Run eine stabile Callback-Funktion für die Panels.
  const statusCallbacks = useRef(new Map<string, (s: ImportStatus) => void>())
  const statusFor = (id: string) => {
    let cb = statusCallbacks.current.get(id)
    if (!cb) {
      cb = (s) => setStatus(id, s)
      statusCallbacks.current.set(id, cb)
    }
    return cb
  }

  async function handleFiles(list: FileList | File[] | null) {
    if (!list || list.length === 0) return
    // Sofort kopieren: die FileList des Eingabefelds ist eine Live-Ansicht.
    const picked = [...list]
    const batchId = `b${++seq.current}`
    setBatches((bs) => [
      { id: batchId, createdAt: Date.now(), names: picked.map((f) => f.name), analyzing: { step: 'Dateien lesen', fraction: 0 }, unknown: [], started: false },
      ...bs,
    ])
    try {
      const { assigned, unknown } = await analyze(picked, importers, (step, fraction) => updateBatch(batchId, { analyzing: { step, fraction } }))
      const newRuns: Record<string, Run> = {}
      assigned.forEach(({ mod, claim }, i) => {
        const id = `${batchId}-${i}`
        newRuns[id] = { id, batchId, mod, claim, included: true, status: { phase: 'queued', fraction: 0 } }
      })
      setRuns((rs) => ({ ...rs, ...newRuns }))
      updateBatch(batchId, { analyzing: null, analyzedAt: Date.now(), unknown })
    } catch (err) {
      updateBatch(batchId, { analyzing: null, error: err instanceof Error ? err.message : 'Dateien konnten nicht gelesen werden' })
    }
  }

  function start(batch: Batch) {
    const ids = Object.values(runs)
      .filter((r) => r.batchId === batch.id && r.included)
      .map((r) => r.id)
    updateBatch(batch.id, { started: true })
    setQueue((q) => [...q, ...ids])
  }

  // Warteschlange: immer nur ein Import gleichzeitig. Ein Import, der auf
  // eine Entscheidung wartet ('input'), hält die nächsten nicht auf.
  useEffect(() => {
    const busy = queue.some((id) => runs[id]?.startedAt && runs[id].status.phase === 'running')
    if (busy) return
    const next = queue.find((id) => runs[id] && !runs[id].startedAt)
    if (!next) return
    setRuns((rs) => ({ ...rs, [next]: { ...rs[next], startedAt: Date.now(), status: { phase: 'running', fraction: 0, step: 'Start' } } }))
  }, [queue, runs])

  const anyActive =
    batches.some((b) => b.analyzing) || queue.some((id) => runs[id] && (!runs[id].startedAt || runs[id].status.phase === 'running'))

  // Uhr für Laufzeiten; Warnung beim Verlassen, solange etwas läuft.
  useEffect(() => {
    if (!anyActive) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => {
      clearInterval(timer)
      window.removeEventListener('beforeunload', warn)
    }
  }, [anyActive])

  const runsByBatch = useMemo(() => {
    const m = new Map<string, Run[]>()
    for (const r of Object.values(runs)) m.set(r.batchId, [...(m.get(r.batchId) ?? []), r])
    return m
  }, [runs])

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Daten importieren</h1>
        <p className="text-xs text-gray-500">
          Dateien einzeln, mehrere zusammen oder als ZIP. Welches Modul und welche Herde sie bekommt, wird am Inhalt erkannt.
          Importe ergänzen nur, sie löschen nichts. Weitere Dateien kannst du jederzeit dazulegen — sie kommen als eigener
          Upload hinzu, laufende Importe gehen weiter.
        </p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFiles(e.dataTransfer.files)
        }}
        className={`block cursor-pointer rounded-lg border-2 border-dashed bg-white p-6 text-center text-sm ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 text-gray-600'
        }`}
      >
        📥 Dateien oder ZIP hierher ziehen oder antippen zum Auswählen
        <input
          type="file"
          multiple
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
          className="sr-only"
        />
      </label>

      {batches.map((batch) => {
        const batchRuns = runsByBatch.get(batch.id) ?? []
        const included = batchRuns.filter((r) => r.included)
        const startedRuns = included.filter((r) => r.startedAt)
        const finishedCount = included.filter((r) => ['done', 'error', 'input'].includes(r.status.phase)).length
        const overall = included.length ? included.reduce((s, r) => s + (r.status.fraction ?? 0), 0) / included.length : 0
        const firstStart = Math.min(...startedRuns.map((r) => r.startedAt!))
        const allFinished = batch.started && included.length > 0 && included.every((r) => r.finishedAt)
        const lastFinish = Math.max(...included.map((r) => r.finishedAt ?? 0))
        const errors = included.filter((r) => r.status.phase === 'error').length
        return (
          <section key={batch.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <h2 className="text-sm font-semibold text-gray-800">
                  Upload {fmtTime(batch.createdAt)} · {batch.names.length === 1 ? batch.names[0] : `${batch.names.length} Dateien`}
                </h2>
                {batch.started && included.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {finishedCount} von {included.length} Importen abgeschlossen · {Math.round(overall * 100)} %
                    {startedRuns.length > 0 &&
                      ` · ${allFinished ? 'Dauer' : 'läuft seit'} ${fmtDuration((allFinished ? lastFinish : now) - firstStart)}`}
                    {errors > 0 && <span className="text-red-700"> · {errors} mit Fehler</span>}
                  </p>
                )}
              </div>
              {(allFinished || (!batch.analyzing && !batch.started)) && (
                <button
                  type="button"
                  onClick={() => setBatches((bs) => bs.filter((b) => b.id !== batch.id))}
                  className="shrink-0 rounded px-2 py-0.5 text-xs text-gray-500 active:bg-gray-200"
                  title="Aus der Ansicht entfernen"
                >
                  ✕
                </button>
              )}
            </div>
            {batch.started && included.length > 0 && <ProgressBar fraction={overall} tone={allFinished ? (errors ? 'red' : 'green') : 'brand'} />}

            {batch.analyzing && (
              <div className="space-y-1 rounded-lg bg-white p-3 text-sm">
                <p className="text-gray-600">{batch.analyzing.step}…</p>
                <ProgressBar fraction={batch.analyzing.fraction} />
              </div>
            )}
            {batch.error && <p className="text-sm text-red-600">{batch.error}</p>}

            {batchRuns.map((r) => {
              const elapsed = r.startedAt ? (r.finishedAt ?? now) - r.startedAt : 0
              const f = r.status.fraction ?? 0
              const remaining = r.status.phase === 'running' && f > 0.1 && f < 1 ? (elapsed * (1 - f)) / f : null
              const place = queue.filter((id) => runs[id] && !runs[id].startedAt).indexOf(r.id)
              const Panel = r.mod.importer!.Panel
              return (
                <div key={r.id} className={`space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm ${r.included ? '' : 'opacity-50'}`}>
                  <div className="flex items-start gap-2">
                    {!batch.started && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={r.included}
                        onChange={(e) => setRuns((rs) => ({ ...rs, [r.id]: { ...r, included: e.target.checked } }))}
                      />
                    )}
                    <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                      <div className="font-medium text-gray-800">
                        {r.mod.icon} {r.claim.format}
                      </div>
                      <div className="text-xs text-gray-500">
                        {r.claim.detail ?? `→ ${r.mod.title}`} · {r.claim.files.length} {r.claim.files.length === 1 ? 'Datei' : 'Dateien'}
                        {r.claim.skipped?.length ? `, davon ${r.claim.skipped.length} nicht gebraucht` : ''}
                      </div>
                    </div>
                    {batch.started && r.included && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_CHIP[r.status.phase]}`}>
                        {PHASE_LABEL[r.status.phase]}
                        {r.status.phase === 'queued' && place >= 0 ? ` (${place + 1}.)` : ''}
                      </span>
                    )}
                  </div>

                  {batch.started && r.included && r.startedAt && (
                    <div className="space-y-1">
                      {r.status.phase === 'running' && <ProgressBar fraction={f} />}
                      <p className="flex flex-wrap justify-between gap-x-3 text-xs text-gray-500">
                        <span>
                          {r.status.phase === 'running' ? `${r.status.step ?? ''} · ${Math.round(f * 100)} %` : (r.status.step ?? '')}
                        </span>
                        <span className="tabular-nums">
                          {r.finishedAt ? `Dauer ${fmtDuration(elapsed)}` : fmtDuration(elapsed)}
                          {remaining != null && remaining > 2000 ? ` · noch ca. ${fmtDuration(remaining)}` : ''}
                          {' · '}
                          <Link to={`/${r.mod.key}`} className="text-brand-700">
                            {r.mod.title} →
                          </Link>
                        </span>
                      </p>
                    </div>
                  )}

                  {batch.started && r.included && (
                    <r.mod.DbProvider>
                      <Panel claim={r.claim} active={!!r.startedAt} onStatus={statusFor(r.id)} />
                    </r.mod.DbProvider>
                  )}
                </div>
              )
            })}

            {!batch.analyzing && batch.unknown.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">
                  {batch.unknown.length === 1 ? '1 Datei wird nicht importiert' : `${batch.unknown.length} Dateien werden nicht importiert`}
                </p>
                <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-xs">
                  {batch.unknown.map((u) => (
                    <li key={u.path} className="[overflow-wrap:anywhere]">
                      <span className="font-mono">{u.path}</span>: {u.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">Unbekannte Formate müssen zuerst im Programm angelernt werden.</p>
              </div>
            )}

            {!batch.analyzing && !batch.error && batchRuns.length === 0 && batch.unknown.length === 0 && (
              <p className="text-sm text-gray-500">Keine Dateien gefunden.</p>
            )}

            {!batch.analyzing && !batch.started && included.length > 0 && (
              <button
                type="button"
                onClick={() => start(batch)}
                className="w-full rounded-lg bg-brand-700 py-3 font-semibold text-white active:bg-brand-800"
              >
                {included.length === 1 ? 'Importieren' : `${included.length} Importe starten`}
              </button>
            )}
          </section>
        )
      })}

      {anyActive && <p className="text-center text-xs text-gray-500">Diese Seite offen lassen, bis die Importe fertig sind.</p>}

      <PasteImport modules={modules} />

      <details className="rounded-lg bg-white p-3 text-sm shadow-sm">
        <summary className="cursor-pointer font-medium text-gray-700">Bekannte Formate</summary>
        <ul className="mt-2 space-y-2">
          {importers.map((m) => (
            <li key={m.key}>
              <span className="font-medium">
                {m.icon} {m.title}
              </span>
              <ul className="list-disc pl-6 text-xs text-gray-600">
                {m.importer!.formats.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {withoutRight.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">Ohne Schreibrecht, darum nicht berücksichtigt: {withoutRight.map((m) => m.title).join(', ')}.</p>
        )}
      </details>
    </div>
  )
}
