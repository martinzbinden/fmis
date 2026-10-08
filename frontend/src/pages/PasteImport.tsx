import { useEffect, useMemo, useState } from 'react'
import { useAuthUser } from '@fmis/core/AuthContext'
import { useDb } from '@fmis/core/DbContext'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { formatSpec, parsePaste, resolveArea, type CheckedRow, type CheckStatus, type PasteBlock, type PasteImporter } from '@fmis/core/pasteImport'

const STATUS: Record<CheckStatus, { label: string; chip: string; row: string }> = {
  neu: { label: 'neu', chip: 'bg-green-100 text-green-800', row: '' },
  aehnlich: { label: 'ähnlich', chip: 'bg-amber-100 text-amber-900', row: 'bg-amber-50' },
  doppelt: { label: 'schon vorhanden', chip: 'bg-gray-200 text-gray-700', row: 'opacity-60' },
  fehler: { label: 'Fehler', chip: 'bg-red-100 text-red-800', row: 'bg-red-50' },
}

/** Ein eingefügter Block: prüfen, Auswahl, bestätigen, übernehmen. */
function BlockCheck({ mod, importer, block }: { mod: ModuleDescriptor; importer: PasteImporter; block: PasteBlock }) {
  const db = useDb()
  const [rows, setRows] = useState<CheckedRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<CheckStatus | 'alle' | 'hinweise'>('alle')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    setRows(null)
    importer
      .check(db, block.daten)
      .then((r) => {
        if (!alive) return
        setRows(r)
        setSelected(new Set(r.filter((x) => x.status === 'neu').map((x) => x.index)))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [db, importer, block, round])

  const counts = useMemo(() => {
    const c: Record<CheckStatus, number> = { neu: 0, aehnlich: 0, doppelt: 0, fehler: 0 }
    for (const r of rows ?? []) c[r.status]++
    return c
  }, [rows])
  const withWarnings = (rows ?? []).filter((r) => r.warnings.length && (r.status === 'neu' || r.status === 'aehnlich')).length
  const shown = (rows ?? []).filter((r) => (filter === 'alle' ? true : filter === 'hinweise' ? r.warnings.length > 0 : r.status === filter))
  const chosen = (rows ?? []).filter((r) => selected.has(r.index))

  async function apply() {
    const warn = chosen.filter((r) => r.warnings.length || r.status === 'aehnlich').length
    if (
      !confirm(
        `${chosen.length} ${chosen.length === 1 ? 'Datensatz' : 'Datensätze'} in «${importer.label}» (${mod.title}) übernehmen?` +
          (warn ? `\n\n${warn} davon mit Hinweisen oder als «ähnlich» markiert — bitte vorher durchsehen.` : '') +
          '\n\nEs wird nur ergänzt, nichts gelöscht oder überschrieben.',
      )
    )
      return
    setBusy(true)
    setResult(null)
    try {
      const n = await importer.apply(db, chosen)
      setResult(`${n} übernommen${n < chosen.length ? ` (${chosen.length - n} waren inzwischen schon vorhanden)` : ''}.`)
      void mod.sync.syncNow()
      setRound((x) => x + 1)
    } catch (e) {
      setResult(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-700">Prüfung fehlgeschlagen: {error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500">Prüfe {block.daten.length} Datensätze…</p>}
      {rows && (
        <>
          <div className="flex flex-wrap gap-1 text-xs">
            <button type="button" onClick={() => setFilter('alle')} className={`rounded-full px-2 py-0.5 ${filter === 'alle' ? 'bg-gray-800 text-white' : 'bg-gray-100'}`}>
              alle {rows.length}
            </button>
            {(Object.keys(STATUS) as CheckStatus[]).map((s) =>
              counts[s] ? (
                <button key={s} type="button" onClick={() => setFilter(s)} className={`rounded-full px-2 py-0.5 ${filter === s ? 'ring-2 ring-gray-800' : ''} ${STATUS[s].chip}`}>
                  {counts[s]} {STATUS[s].label}
                </button>
              ) : null,
            )}
            {withWarnings > 0 && (
              <button type="button" onClick={() => setFilter('hinweise')} className={`rounded-full bg-amber-100 px-2 py-0.5 text-amber-900 ${filter === 'hinweise' ? 'ring-2 ring-gray-800' : ''}`}>
                ⚠ {withWarnings} mit Hinweis
              </button>
            )}
          </div>
          <ul className="max-h-[55vh] divide-y overflow-y-auto rounded border border-gray-200 bg-white">
            {shown.map((r) => {
              const selectable = r.status === 'neu' || r.status === 'aehnlich'
              return (
                <li key={r.index} className={`flex items-start gap-2 px-2 py-1.5 text-sm ${STATUS[r.status].row}`}>
                  <input type="checkbox" className="mt-1" disabled={!selectable || busy} checked={selected.has(r.index)} onChange={() => toggle(r.index)} />
                  <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <div className="flex flex-wrap items-baseline gap-1">
                      <span className="text-xs text-gray-400">#{r.index + 1}</span>
                      <span className="text-gray-800">{r.title}</span>
                      <span className={`rounded px-1 text-[10px] ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
                    </div>
                    {r.detail && <div className="text-xs text-gray-500">{r.detail}</div>}
                    {r.problems.map((p) => (
                      <div key={p} className={`text-xs ${r.status === 'fehler' ? 'text-red-700' : r.status === 'aehnlich' ? 'text-amber-900' : 'text-gray-600'}`}>
                        {r.status === 'fehler' ? '✗' : '•'} {p}
                      </div>
                    ))}
                    {(r.info ?? []).map((t) => (
                      <div key={t} className="text-xs text-gray-500">
                        ℹ {t}
                      </div>
                    ))}
                    {r.warnings.map((w) => (
                      <div key={w} className="text-xs text-amber-800">
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="text-brand-700 underline" onClick={() => setSelected(new Set(rows.filter((r) => r.status === 'neu').map((r) => r.index)))}>
              alle neuen
            </button>
            <button type="button" className="text-brand-700 underline" onClick={() => setSelected(new Set(rows.filter((r) => r.status === 'neu' && !r.warnings.length).map((r) => r.index)))}>
              nur neue ohne Hinweis
            </button>
            <button type="button" className="text-brand-700 underline" onClick={() => setSelected(new Set())}>
              keine
            </button>
          </div>
          {result && <p className="rounded bg-sky-50 p-2 text-sm text-sky-900">{result}</p>}
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void apply()}
            className="w-full rounded-lg bg-brand-700 py-2.5 font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Übernehme…' : `${chosen.length} ${chosen.length === 1 ? 'Datensatz' : 'Datensätze'} übernehmen`}
          </button>
        </>
      )}
    </div>
  )
}

/** «Strukturierte Daten einfügen»: aufbereitete Datensätze (JSON, Format
 * core/frontend/src/pasteImport.ts) prüfen und nach Bestätigung übernehmen. */
export default function PasteImport({ modules }: { modules: ModuleDescriptor[] }) {
  const user = useAuthUser()
  const allowed = useMemo(
    () =>
      modules
        .map((m) => ({ ...m, pasteImporters: (m.pasteImporters ?? []).filter((p) => user?.permissions.includes(p.permission)) }))
        .filter((m) => m.pasteImporters.length > 0),
    [modules, user],
  )
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<{ id: number; mod: ModuleDescriptor; importer: PasteImporter; block: PasteBlock }[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  function check() {
    setError(null)
    try {
      const blocks = parsePaste(text)
      const now = Date.now()
      setChecks(
        blocks.map((block, i) => {
          const { mod, importer } = resolveArea(block.bereich, allowed)
          return { id: now + i, mod: modules.find((m) => m.key === mod.key)!, importer, block }
        }),
      )
    } catch (e) {
      setChecks([])
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function copy(spec: string, key: string) {
    try {
      await navigator.clipboard.writeText(spec)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setText(spec)
    }
  }

  if (allowed.length === 0) return null
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div>
        <h2 className="font-semibold text-gray-800">Strukturierte Daten einfügen</h2>
        <p className="text-xs text-gray-500">
          Aufbereitete Datensätze (JSON) hier hineinkopieren. Das System prüft Pflichtfelder, Plausibilität und Doppelerfassungen; du siehst jeden
          Datensatz und bestätigst, was übernommen wird. Es wird nur ergänzt.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={'{ "fmis_import": 1, "bereich": "dairy.behandlungen", "quelle": "…", "daten": [ … ] }'}
        className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!text.trim()} onClick={check} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Prüfen
        </button>
        {(text || checks.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setText('')
              setChecks([])
              setError(null)
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
          >
            Leeren
          </button>
        )}
      </div>
      {error && <p className="whitespace-pre-line rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {checks.map((c) => (
        <div key={c.id} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <div className="text-sm">
            <span className="font-medium text-gray-800">
              {c.mod.icon} {c.importer.label}
            </span>{' '}
            <span className="text-xs text-gray-500">
              → {c.mod.title} · {c.block.daten.length} Datensätze{c.block.quelle ? ` · Quelle: ${c.block.quelle}` : ''}
            </span>
          </div>
          <c.mod.DbProvider>
            <BlockCheck mod={c.mod} importer={c.importer} block={c.block} />
          </c.mod.DbProvider>
        </div>
      ))}

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-700">Bereiche und Format</summary>
        <ul className="mt-2 space-y-3">
          {allowed.flatMap((m) =>
            m.pasteImporters.map((p) => {
              const key = `${m.key}.${p.area}`
              const spec = formatSpec(m.key, m.title, p)
              return (
                <li key={key} className="rounded border border-gray-200 p-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <span className="font-medium">
                        {m.icon} {p.label}
                      </span>{' '}
                      <code className="text-xs text-gray-500">{key}</code>
                    </span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => void copy(spec, key)} className="rounded border border-gray-300 px-2 py-0.5 text-xs">
                        {copied === key ? '✓ kopiert' : 'Beschreibung kopieren'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setText(JSON.stringify({ fmis_import: 1, bereich: key, quelle: 'Beispiel', daten: p.example }, null, 2))}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs"
                      >
                        Beispiel
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{p.description}</p>
                  <table className="mt-1 w-full text-xs">
                    <tbody>
                      {p.fields.map((f) => (
                        <tr key={f.name} className="border-t align-top">
                          <td className="py-0.5 pr-2 font-mono">
                            {f.name}
                            {f.required ? '*' : ''}
                          </td>
                          <td className="py-0.5 pr-2 text-gray-500">{f.type}</td>
                          <td className="py-0.5 text-gray-600">{f.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              )
            }),
          )}
        </ul>
      </details>
    </section>
  )
}
