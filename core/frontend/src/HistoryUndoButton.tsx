import { useState } from 'react'
import { useHasPermission } from './AuthContext'
import { fetchHistory, type HistoryEntry } from './historyApi'
import { describeRejected } from './outbox'
import { syncModuleNow } from './sync'
import { notifyError, notifySuccess } from './toast'

/** Admins: Zeilen-Stand vor einer Änderung wiederherstellen; null = Zeile löschen.
 * false = auf diesem Gerät änderte sich nichts. */
export type RestoreRowState = (table: string, rowId: string, state: Record<string, unknown> | null) => Promise<boolean>

function parse(snapshot: string): Record<string, unknown> | null {
  try {
    return JSON.parse(snapshot) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Was «Rückgängig» für diesen Verlaufseintrag hiesse: der Stand davor (aus dem
 * vorherigen Eintrag derselben Zeile) oder — bei «Neu» — Löschen. Rein, für Tests. */
export function undoPlan(entry: Pick<HistoryEntry, 'id' | 'action'>, rowHistory: Pick<HistoryEntry, 'id' | 'snapshot' | 'changed_at'>[]): { state: Record<string, unknown> | null; later: number } | { error: string } {
  const sorted = [...rowHistory].sort((a, b) => b.changed_at.localeCompare(a.changed_at))
  const i = sorted.findIndex((e) => e.id === entry.id)
  if (i < 0) return { error: 'Eintrag im Verlauf nicht gefunden.' }
  if (entry.action === 'insert') return { state: null, later: i }
  const prev = sorted[i + 1]
  const state = prev ? parse(prev.snapshot) : null
  if (!state) return { error: 'Der Stand vor dieser Änderung ist nicht im Verlauf.' }
  return { state: { ...state, deleted_at: state.deleted_at ?? null }, later: i }
}

/** «Rückgängig» im Protokoll — nur für Admins und über die laufende Sitzung hinaus.
 * Wird selbst als neue Änderung gespeichert (und steht damit wieder im Verlauf). */
export default function HistoryUndoButton({ moduleKey, entry, restore }: { moduleKey: string; entry: HistoryEntry; restore: RestoreRowState }) {
  const isAdmin = useHasPermission('core:users:manage')
  const [plan, setPlan] = useState<{ state: Record<string, unknown> | null; later: number } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!isAdmin) return null

  async function prepare() {
    setBusy(true)
    try {
      const rows = await fetchHistory(moduleKey, { rowId: entry.row_id, limit: 1000 })
      const p = undoPlan(entry, rows)
      if ('error' in p) notifyError(p.error)
      else setPlan(p)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (!plan) return
    setBusy(true)
    try {
      if (!(await restore(entry.table_name, entry.row_id, plan.state))) {
        notifyError('Auf diesem Gerät gibt es diesen Eintrag nicht (mehr) — zuerst synchronisieren (Punkt oben rechts), dann nochmals versuchen.')
        return
      }
      // erst nach der Antwort des Servers Erfolg melden
      const rejected = (await syncModuleNow(moduleKey)).filter((r) => r.table === entry.table_name && r.id === entry.row_id)
      if (rejected.length > 0) notifyError(`Vom Server abgelehnt: ${describeRejected(rejected)}`)
      else if (!navigator.onLine) notifySuccess('Zurückgenommen — wird gesendet, sobald das Gerät wieder Netz hat')
      else notifySuccess(plan.state ? 'Stand vor der Änderung wiederhergestellt' : 'Neuer Eintrag gelöscht')
      setPlan(null)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!plan) {
    return (
      <button type="button" disabled={busy} onClick={() => void prepare()} className="min-h-11 rounded-lg border border-gray-300 px-2 text-xs text-gray-700 disabled:opacity-50" title="Nur Admins">
        {busy ? '…' : '↶ Rückgängig'}
      </button>
    )
  }
  return (
    <div className="mt-2 w-full space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
      <p>
        {plan.state ? 'Stand vor dieser Änderung wiederherstellen?' : 'Dieser neue Eintrag wird gelöscht.'}
        {plan.later > 0 && ` Danach wurde er noch ${plan.later}× geändert — auch das geht verloren.`}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void run()} className="min-h-11 rounded-lg bg-amber-700 px-3 font-semibold text-white disabled:opacity-50">
          Ja, zurücknehmen
        </button>
        <button type="button" onClick={() => setPlan(null)} className="min-h-11 rounded-lg border border-amber-700 px-3">
          Abbrechen
        </button>
      </div>
    </div>
  )
}
