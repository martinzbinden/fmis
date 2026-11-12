import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchHistory, type HistoryEntry } from '@fmis/core/historyApi'
import { describeRejected } from '@fmis/core/outbox'
import { syncModuleNow } from '@fmis/core/sync'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { restoreRowState } from '../db/write'
import { fmtDateTime } from '../lib/format'
import { buildSteps, describeStep, planStepUndo, stepsOfGroup, type Step, type UndoRow } from '../lib/groupHistory'
import type { HerdData } from '../lib/herds'
import type { HerdGroup } from '../types'
import Modal from './Modal'

const WINDOW = 1500

/** Verlauf einer Gruppe, Schritt für Schritt, mit «Rückgängig» je Schritt. Ein Schritt ist, was in einem Zug
 * geändert wurde (z.B. «23 Tiere zugeteilt»); Zurücknehmen stellt die betroffenen Zeilen auf den Stand davor
 * und steht danach selbst wieder im Verlauf. Betrifft ein Schritt auch andere Gruppen, wird er als Ganzes
 * zurückgenommen (sonst stünden Tiere in keiner Gruppe). */
export default function GroupHistoryDialog({ data, group, onChanged, onClose }: { data: HerdData; group: HerdGroup; onChanged: () => void; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ step: Step; rows: UndoRow[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    fetchHistory('tiere', { limit: WINDOW }).then(setEntries, (e: unknown) => setError(errorText(e)))
  }, [])
  useEffect(load, [load])

  const nameOf = (id: string) => data.groups.find((g) => g.id === id)?.name ?? 'Gruppe?'
  // gleiche Schritte bei jedem Rendern (das Bestätigungsfeld erkennt seinen Schritt daran wieder)
  const steps = useMemo(() => (entries ? stepsOfGroup(buildSteps(entries), group.id).slice(0, 20) : []), [entries, group.id])

  async function prepare(step: Step) {
    if (!entries) return
    setBusy(true)
    try {
      let all = entries
      let plan = planStepUndo(step, all)
      // früherer Stand ausserhalb des geladenen Fensters: je Zeile nachladen
      for (const m of plan.missing) all = [...all, ...(await fetchHistory('tiere', { rowId: m.row_id, limit: 1000 }))]
      all = [...new Map(all.map((e) => [e.id, e])).values()]
      if (plan.missing.length) plan = planStepUndo(step, all)
      if (plan.missing.length) {
        notifyError('Der Stand vor diesem Schritt ist nicht im Verlauf — er lässt sich nicht zurücknehmen.')
        return
      }
      setConfirm({ step, rows: plan.rows })
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (!confirm) return
    setBusy(true)
    try {
      let changed = 0
      for (const r of confirm.rows) if (await restoreRowState(r.table_name, r.row_id, r.state)) changed++
      // erst nach der Antwort des Servers Erfolg melden
      const rejected = (await syncModuleNow('tiere')).filter((r) => confirm.rows.some((x) => x.table_name === r.table && x.row_id === r.id))
      if (rejected.length > 0) notifyError(`Vom Server abgelehnt: ${describeRejected(rejected)}`)
      else if (!navigator.onLine) notifySuccess('Zurückgenommen — wird gesendet, sobald das Gerät wieder Netz hat')
      else notifySuccess(changed === 0 ? 'Nichts zu ändern — der Stand war schon so' : `Schritt zurückgenommen (${changed} Einträge)`)
      setConfirm(null)
      onChanged()
      load()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Verlauf «${group.name}»`} onClose={onClose} dirty={false}>
      <div className="space-y-3 text-sm">
        {error && (
          <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
            {error} Der Verlauf wird vom Server gelesen und ist offline nicht verfügbar.{' '}
            <button type="button" onClick={load} className="font-semibold underline">
              Nochmals versuchen
            </button>
          </p>
        )}
        {!entries && !error && <p className="text-gray-500">Lädt …</p>}
        {entries && steps.length === 0 && <p className="text-gray-600">Noch keine Änderungen an dieser Gruppe im Verlauf.</p>}

        <ul className="space-y-2">
          {steps.map((step, i) => {
            const s = describeStep(step, group.id, nameOf)
            const confirming = confirm?.step.entries[0].id === step.entries[0].id
            return (
              <li key={step.entries[0].id} className="rounded-lg border border-gray-200 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900">{s.title}</div>
                    <div className="text-xs text-gray-600">
                      {fmtDateTime(step.at)} · {step.by ?? 'unbekannt'}
                    </div>
                    {s.others.length > 0 && <div className="text-xs text-amber-800">betraf auch: {s.others.map((n) => `«${n}»`).join(', ')}</div>}
                  </div>
                  {!confirming && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void prepare(step)}
                      className={`min-h-11 shrink-0 rounded-lg px-3 font-medium disabled:opacity-50 ${i === 0 ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
                    >
                      ↶ Rückgängig
                    </button>
                  )}
                </div>
                {confirming && (
                  <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-2 text-amber-900">
                    <p>
                      Diesen Schritt zurücknehmen? {confirm.rows.length} Einträge gehen auf den Stand davor zurück.
                      {s.others.length > 0 && ` Auch ${s.others.map((n) => `«${n}»`).join(', ')} ${s.others.length === 1 ? 'ist' : 'sind'} davon betroffen.`}
                    </p>
                    {confirm.rows.some((r) => r.later > 0) && (
                      <p className="font-medium">
                        {confirm.rows.filter((r) => r.later > 0).length} Einträge wurden danach noch geändert — diese späteren Änderungen gehen dabei verloren.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void run()} className="min-h-11 rounded-lg bg-amber-700 px-3 font-semibold text-white disabled:opacity-50">
                        {busy ? 'speichert …' : 'Ja, zurücknehmen'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="min-h-11 rounded-lg border border-amber-700 px-3">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {entries && entries.length >= WINDOW && <p className="text-xs text-gray-500">Gezeigt werden die neuesten Änderungen; ältere stehen im Verlauf des Moduls.</p>}
      </div>
    </Modal>
  )
}
