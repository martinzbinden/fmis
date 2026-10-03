import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthUser } from '@fmis/core/AuthContext'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { expandUploads, type ImportClaim, type UploadFile } from '@fmis/core/upload'

interface Assigned {
  id: string
  mod: ModuleDescriptor
  claim: ImportClaim
}

interface Analysis {
  assigned: Assigned[]
  unknown: { path: string; reason: string }[]
}

/** Alle Dateien einer Auswahl den Modulen zuordnen (core/frontend/src/upload.ts).
 * Jedes Modul sieht nur noch, was die vorherigen nicht übernommen haben. */
async function analyze(picked: File[], importers: ModuleDescriptor[]): Promise<Analysis> {
  const { files, ignored } = await expandUploads(picked)
  let rest: UploadFile[] = files
  const reasons = new Map<string, string>()
  const assigned: Assigned[] = []
  for (const mod of importers) {
    try {
      const { claims, rejected } = await mod.importer!.detect(rest)
      for (const r of rejected ?? []) if (!reasons.has(r.file.path)) reasons.set(r.file.path, r.reason)
      const taken = new Set(claims.flatMap((c) => c.files.map((f) => f.path)))
      rest = rest.filter((f) => !taken.has(f.path))
      claims.forEach((claim, i) => assigned.push({ id: `${mod.key}-${i}`, mod, claim }))
    } catch (err) {
      console.error(`Erkennung ${mod.key} fehlgeschlagen`, err)
    }
  }
  const unknown = [
    ...ignored,
    ...rest.map((f) => ({ path: f.path, reason: reasons.get(f.path) ?? 'Format nicht bekannt' })),
  ]
  return { assigned, unknown }
}

/** Eine Upload-Seite für alle Module: Dateien oder ZIPs ablegen, die
 * Zuordnung (Modul, Herde/Tierart, Betrieb) passiert automatisch. Was kein
 * Modul kennt, wird gemeldet — neue Formate müssen zuerst im Code angelernt
 * werden (ModuleImporter eines Moduls). */
export default function Upload({ modules }: { modules: ModuleDescriptor[] }) {
  const user = useAuthUser()
  const importers = modules.filter((m) => m.importer && user?.permissions.includes(m.importer.permission))
  const withoutRight = modules.filter((m) => m.importer && user && !user.permissions.includes(m.importer.permission))
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState<Assigned[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(list: FileList | File[] | null) {
    if (!list || list.length === 0) return
    // Sofort kopieren: die FileList des Eingabefelds ist eine Live-Ansicht.
    const picked = [...list]
    setBusy(true)
    setError(null)
    setAnalysis(null)
    setRunning(null)
    setExcluded(new Set())
    try {
      setAnalysis(await analyze(picked, importers))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dateien konnten nicht gelesen werden')
    } finally {
      setBusy(false)
    }
  }

  const selected = analysis?.assigned.filter((a) => !excluded.has(a.id)) ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Daten importieren</h1>
        <p className="text-xs text-gray-500">
          Dateien einzeln, mehrere zusammen oder als ZIP. Welches Modul und welche Herde sie bekommt, wird am Inhalt erkannt.
          Importe ergänzen nur, sie löschen nichts.
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
        {busy ? 'Dateien werden gelesen…' : '📥 Dateien oder ZIP hierher ziehen oder antippen zum Auswählen'}
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
          className="sr-only"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {analysis && !running && (
        <section className="space-y-2">
          {analysis.assigned.length > 0 && <h2 className="text-sm font-semibold text-gray-700">Erkannt</h2>}
          {analysis.assigned.map((a) => (
            <label key={a.id} className="flex items-start gap-3 rounded-lg bg-white p-3 text-sm shadow-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!excluded.has(a.id)}
                onChange={(e) => {
                  const next = new Set(excluded)
                  if (e.target.checked) next.delete(a.id)
                  else next.add(a.id)
                  setExcluded(next)
                }}
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block font-medium text-gray-800">
                  {a.mod.icon} {a.claim.format}
                </span>
                <span className="block text-xs text-gray-500">
                  {a.claim.detail ?? `→ ${a.mod.title}`} · {a.claim.files.length} {a.claim.files.length === 1 ? 'Datei' : 'Dateien'}
                  {a.claim.skipped?.length ? `, davon ${a.claim.skipped.length} nicht gebraucht` : ''}
                </span>
              </span>
            </label>
          ))}

          {analysis.unknown.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">
                {analysis.unknown.length === 1 ? '1 Datei wird nicht importiert' : `${analysis.unknown.length} Dateien werden nicht importiert`}
              </p>
              <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-xs">
                {analysis.unknown.map((u) => (
                  <li key={u.path}>
                    <span className="break-all font-mono">{u.path}</span>: {u.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">Unbekannte Formate müssen zuerst im Programm angelernt werden.</p>
            </div>
          )}

          {analysis.assigned.length === 0 && analysis.unknown.length === 0 && (
            <p className="text-sm text-gray-500">Keine Dateien gefunden.</p>
          )}

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setRunning(selected)}
              className="w-full rounded-lg bg-brand-700 py-3 font-semibold text-white active:bg-brand-800"
            >
              {selected.length === 1 ? 'Importieren' : `${selected.length} Importe starten`}
            </button>
          )}
        </section>
      )}

      {running && (
        <section className="space-y-3">
          {running.map((a) => {
            const { Panel } = a.mod.importer!
            return (
              <div key={a.id} className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="min-w-0 font-semibold text-gray-800 [overflow-wrap:anywhere]">
                    {a.mod.icon} {a.claim.format}
                  </h2>
                  <Link to={`/${a.mod.key}`} className="shrink-0 text-xs text-brand-700">
                    {a.mod.title} →
                  </Link>
                </div>
                <a.mod.DbProvider>
                  <Panel claim={a.claim} />
                </a.mod.DbProvider>
              </div>
            )
          })}
        </section>
      )}

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
