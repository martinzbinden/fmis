import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import MachineMaintenance, { machineStatuses, STATE_LABEL, STATE_STYLE } from '../components/MachineMaintenance'
import { fmtDate } from '../lib/format'
import { CATEGORY_ICON, CATEGORY_LABEL, categoryOf, counterUnit, parseTaskIds, TEMPLATES, type DueState } from '../lib/maintenance'
import { applyTemplates, loadMaintenanceData } from '../lib/maintenanceData'
import type { Machine, MachineCategory } from '../types'

const CATEGORIES: MachineCategory[] = ['zugfahrzeug', 'anbaugeraet', 'anhaenger', 'auto', 'uebrige']
const STORAGE_KEY = 'wiesenjournal_wartung_view'

const chf = (v: number) => `CHF ${v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function loadView(): { category: MachineCategory | 'alle'; onlyDue: boolean; tab: 'plan' | 'journal' } {
  try {
    return { category: 'alle', onlyDue: false, tab: 'plan', ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as object) }
  } catch {
    return { category: 'alle', onlyDue: false, tab: 'plan' }
  }
}

/** Wartungsjournal aller Maschinen: Kategorien als Knöpfe, je Maschine der
 * Wartungsplan mit Fälligkeit (Stundenzähler/km bzw. GPS-Stunden und
 * Monate) und das Journal; Kosten je Jahr und Eigentümer. */
export default function Maintenance() {
  const { data, loading, refresh } = useQuery(loadMaintenanceData, [])
  const canWrite = useHasPermission('wiesenjournal:tracking:write')
  const [view, setViewState] = useState(loadView)
  const setView = (patch: Partial<typeof view>) => {
    const next = { ...view, ...patch }
    setViewState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // nur bis zum Neuladen
    }
  }
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    if (!data) return []
    return data.machines
      .filter((m) => m.active)
      .map((m) => {
        const statuses = machineStatuses(m, data.tasks, data.log, data.tracksByMachine.get(m.id) ?? [])
        const counts: Record<DueState, number> = { faellig: 0, bald: 0, offen: 0, ok: 0 }
        for (const s of statuses) counts[s.state]++
        return { m, category: categoryOf(m), statuses, counts }
      })
  }, [data])

  const inCategory = rows.filter((r) => view.category === 'alle' || r.category === view.category)
  const shown = inCategory.filter((r) => !view.onlyDue || r.counts.faellig + r.counts.bald > 0)
  const withoutPlan = rows.filter((r) => r.statuses.length === 0 && (TEMPLATES[r.m.kind] ?? []).length > 0)
  const total = (s: DueState) => inCategory.reduce((sum, r) => sum + r.counts[s], 0)

  // Journal: alle Einträge der Kategorie, Kosten je Jahr und Eigentümer
  const byId = new Map((data?.machines ?? []).map((m) => [m.id, m]))
  const taskName = new Map((data?.tasks ?? []).map((t) => [t.id, t.title]))
  const journal = (data?.log ?? []).filter((l) => {
    const m = byId.get(l.machine_id)
    return m && (view.category === 'alle' || categoryOf(m) === view.category)
  })
  const costs = new Map<string, Map<string, number>>()
  for (const l of journal) {
    if (l.cost_chf == null) continue
    const year = l.done_date.slice(0, 4)
    const owner = byId.get(l.machine_id)?.owner ?? 'eigene'
    const y = costs.get(year) ?? new Map<string, number>()
    y.set(owner, (y.get(owner) ?? 0) + l.cost_chf)
    costs.set(year, y)
  }

  async function applyAll() {
    setBusy(true)
    try {
      await applyTemplates(withoutPlan.map((r) => r.m), data!.tasks)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpen(next)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 pb-24">
      <div>
        <Link to="../maschinen" className="text-sm text-brand-700">
          ← Maschinen
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Wartungsjournal</h1>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['alle', ...CATEGORIES] as const).map((c) => {
          const n = c === 'alle' ? rows.length : rows.filter((r) => r.category === c).length
          if (c !== 'alle' && n === 0) return null
          const due = rows.filter((r) => (c === 'alle' || r.category === c) && r.counts.faellig > 0).length
          return (
            <button
              key={c}
              type="button"
              onClick={() => setView({ category: c })}
              className={`rounded-lg px-3 py-1.5 text-sm ${view.category === c ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
            >
              {c === 'alle' ? 'Alle' : `${CATEGORY_ICON[c]} ${CATEGORY_LABEL[c]}`} <span className="opacity-70">{n}</span>
              {due > 0 && <span className="ml-1 rounded bg-red-600 px-1 text-[10px] font-semibold text-white">{due}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['plan', 'journal'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setView({ tab: t })}
            className={`rounded px-2 py-0.5 ${view.tab === t ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-600'}`}
          >
            {t === 'plan' ? 'Fälligkeiten' : 'Journal & Kosten'}
          </button>
        ))}
        {view.tab === 'plan' && (
          <>
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input type="checkbox" checked={view.onlyDue} onChange={(e) => setView({ onlyDue: e.target.checked })} />
              nur fällige und bald fällige
            </label>
            <span className="flex gap-1 text-xs">
              {(['faellig', 'bald', 'offen'] as const).map((s) =>
                total(s) ? (
                  <span key={s} className={`rounded px-1.5 py-0.5 ${STATE_STYLE[s]}`}>
                    {total(s)} {STATE_LABEL[s]}
                  </span>
                ) : null,
              )}
            </span>
          </>
        )}
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}

      {view.tab === 'plan' && canWrite && withoutPlan.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <span>
            {withoutPlan.length} {withoutPlan.length === 1 ? 'Maschine hat' : 'Maschinen haben'} noch keinen Wartungsplan. Die Standard-Pläne enthalten übliche
            Intervalle (Ölwechsel, Filter, Abschmieren, Kontrollen) — danach an die Betriebsanleitung anpassen.
          </span>
          <button type="button" disabled={busy} onClick={() => void applyAll()} className="rounded-lg bg-sky-700 px-3 py-1.5 text-white disabled:opacity-50">
            {busy ? 'Übernimmt…' : 'Standard-Pläne übernehmen'}
          </button>
        </div>
      )}

      {view.tab === 'plan' && (
        <ul className="space-y-2">
          {shown.map(({ m, counts, statuses }) => {
            const isOpen = open.has(m.id)
            return (
              <li key={m.id} className="rounded-lg bg-white shadow-sm">
                <button type="button" onClick={() => toggle(m.id)} className="flex w-full items-center gap-2 p-3 text-left">
                  <span className="text-lg">{CATEGORY_ICON[categoryOf(m)]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-800">{m.name}</span>
                    <span className="block text-xs text-gray-500">
                      {m.owner ? `gehört ${m.owner} · ` : ''}
                      {statuses.length ? `${statuses.length} ${statuses.length === 1 ? 'Aufgabe' : 'Aufgaben'}` : 'kein Wartungsplan'}
                      {statuses[0] && statuses[0].state !== 'ok' && statuses[0].state !== 'offen' ? ` · ${statuses[0].task.title}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1 text-[10px]">
                    {(['faellig', 'bald', 'offen'] as const).map((s) =>
                      counts[s] ? (
                        <span key={s} className={`rounded px-1.5 py-0.5 font-medium ${STATE_STYLE[s]}`}>
                          {counts[s]} {STATE_LABEL[s]}
                        </span>
                      ) : null,
                    )}
                    {statuses.length > 0 && counts.faellig + counts.bald + counts.offen === 0 && (
                      <span className={`rounded px-1.5 py-0.5 font-medium ${STATE_STYLE.ok}`}>alles ok</span>
                    )}
                  </span>
                  <span className="text-gray-300">{isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && data && (
                  <div className="border-t p-3">
                    <MachineMaintenance
                      machine={m}
                      tasks={data.tasks}
                      log={data.log}
                      tracks={data.tracksByMachine.get(m.id) ?? []}
                      canWrite={canWrite}
                      onChanged={refresh}
                    />
                    <Link to={`../maschinen/${m.id}`} className="mt-2 inline-block text-xs text-brand-700">
                      Maschine →
                    </Link>
                  </div>
                )}
              </li>
            )
          })}
          {data && shown.length === 0 && <p className="text-center text-sm text-gray-500">Nichts fällig.</p>}
        </ul>
      )}

      {view.tab === 'journal' && (
        <div className="space-y-3">
          {costs.size > 0 && (
            <div className="rounded-lg bg-white p-3 text-sm shadow-sm">
              <h2 className="mb-1 text-xs font-semibold uppercase text-gray-500">Kosten je Jahr</h2>
              <table className="w-full text-sm">
                <tbody>
                  {[...costs]
                    .sort((a, b) => b[0].localeCompare(a[0]))
                    .map(([year, owners]) => (
                      <tr key={year} className="border-t first:border-0">
                        <td className="py-1 pr-2 font-medium text-gray-700">{year}</td>
                        <td className="py-1 text-gray-600">
                          {[...owners].map(([o, v]) => `${o === 'eigene' ? 'eigene Maschinen' : o}: ${chf(v)}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {journal.length === 0 ? (
            <p className="text-center text-sm text-gray-500">Noch keine Einträge.</p>
          ) : (
            <ul className="divide-y rounded-lg bg-white shadow-sm">
              {journal.map((l) => {
                const m = byId.get(l.machine_id) as Machine
                return (
                  <li key={l.id} className="px-3 py-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-800">
                        {fmtDate(l.done_date)} · <b>{m.name}</b>
                        {l.counter != null ? ` · ${l.counter.toLocaleString('de-CH')} ${counterUnit(m)}` : ''}
                      </span>
                      {l.cost_chf != null && <span className="shrink-0">{chf(l.cost_chf)}</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {[l.title, ...parseTaskIds(l.task_ids).map((id) => taskName.get(id) ?? 'gelöschte Aufgabe'), l.material, l.done_by, m.owner ? `gehört ${m.owner}` : null]
                        .filter(Boolean)
                        .join(' · ') || (l.entry_type === 'zaehlerstand' ? 'Zählerstand' : '')}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
