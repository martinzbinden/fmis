import { useState } from 'react'
import Modal from './Modal'
import { fmtArea, todayIso } from '../lib/format'
import type { PlanTask } from '../lib/workPlan'

const UNIT: Record<string, string> = { m3: 'm³', t: 't', kg: 'kg' }
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

/** Arbeit abschliessen: je Parzelle erledigt ja/nein, definitive Menge
 * (vorgeschlagen: gezählte Fässer, sonst geplant), Anzahl Fässer/Fuhren und
 * Ausführungsdatum. Erledigtes wird im Wiesenjournal definitiv, der Rest
 * bleibt geplant. Für die Karte (nach GPS) und den Arbeitsplan (ohne GPS). */
export default function CompletePlanDialog({
  task,
  visited,
  tanks,
  onClose,
  onDone,
  onCancelPlan,
}: {
  task: PlanTask
  /** per GPS befahrene Parzellen (vorausgewählt); ohne: alle */
  visited?: Set<string>
  /** gezählte Fässer je Parzelle */
  tanks?: Map<string, { m3: number; count: number }>
  onClose: () => void
  onDone: (done: Set<string>, date: string, amounts: Map<string, { amount: number; count: number | null }>) => Promise<void>
  onCancelPlan?: () => void
}) {
  const [done, setDone] = useState<Set<string>>(() => new Set(visited ?? task.items.map((i) => i.parcel_id)))
  const [date, setDate] = useState(task.date < todayIso() ? task.date : todayIso())
  const fert = task.unit != null
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(task.items.map((i) => [i.parcel_id, String(tanks?.get(i.parcel_id)?.m3 ?? i.amount ?? '')])),
  )
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(task.items.map((i) => [i.parcel_id, tanks?.get(i.parcel_id) ? String(tanks.get(i.parcel_id)!.count) : ''])),
  )
  const [saving, setSaving] = useState(false)
  const toggle = (id: string) =>
    setDone((d) => {
      const next = new Set(d)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const totalDone = task.items.filter((i) => done.has(i.parcel_id)).reduce((s, i) => s + (num(amounts[i.parcel_id]) ?? 0), 0)

  async function save() {
    setSaving(true)
    try {
      const m = new Map<string, { amount: number; count: number | null }>()
      if (fert)
        for (const it of task.items) {
          const a = num(amounts[it.parcel_id])
          if (done.has(it.parcel_id) && a != null) m.set(it.parcel_id, { amount: a, count: num(counts[it.parcel_id]) })
        }
      await onDone(done, date, m)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Erledigt: ${task.title}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Angekreuzte Parzellen werden im Wiesenjournal definitiv{fert ? ' — mit der bestätigten Menge, Nährstoffe neu gerechnet' : ''}. Nicht
          angekreuzte bleiben geplant.
          {visited ? ' Vorausgewählt ist, was laut GPS befahren wurde.' : ''}
        </p>
        <label className="flex items-center gap-2">
          <span className="text-gray-700">ausgeführt am</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
        </label>
        <ul className="divide-y">
          {task.items.map((it) => {
            const t = tanks?.get(it.parcel_id)
            return (
              <li key={it.parcel_id} className="py-1.5">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={done.has(it.parcel_id)} onChange={() => toggle(it.parcel_id)} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{it.parcel_name}</span>
                    <span className="ml-1 text-xs text-gray-500">{fmtArea(it.area_a)}</span>
                    {visited?.has(it.parcel_id) && <span className="ml-1 text-xs text-green-700">befahren</span>}
                  </span>
                  {fert && (
                    <span className="flex shrink-0 items-center gap-1">
                      <input
                        inputMode="decimal"
                        disabled={!done.has(it.parcel_id)}
                        value={amounts[it.parcel_id]}
                        onChange={(e) => setAmounts({ ...amounts, [it.parcel_id]: e.target.value })}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-right disabled:opacity-40"
                      />
                      <span className="w-6 text-xs text-gray-500">{UNIT[task.unit!]}</span>
                    </span>
                  )}
                </div>
                {fert && done.has(it.parcel_id) && (
                  <div className="ml-6 mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {it.amount != null && <span>geplant {it.amount.toLocaleString('de-CH')} {UNIT[task.unit!]}</span>}
                    {t && (
                      <span className="text-amber-800">
                        gezählt {t.count} {t.count === 1 ? 'Fass' : 'Fässer'} = {t.m3} m³
                      </span>
                    )}
                    <label className="flex items-center gap-1">
                      Fässer/Fuhren
                      <input
                        inputMode="numeric"
                        value={counts[it.parcel_id]}
                        onChange={(e) => setCounts({ ...counts, [it.parcel_id]: e.target.value.replace(/\D/g, '') })}
                        className="w-12 rounded border border-gray-300 px-1 py-0.5 text-right"
                      />
                    </label>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          disabled={saving || done.size === 0}
          onClick={() => void save()}
          className="w-full rounded-lg bg-green-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {done.size} {done.size === 1 ? 'Parzelle' : 'Parzellen'} definitiv eintragen
          {fert && totalDone ? ` · ${Math.round(totalDone * 10) / 10} ${UNIT[task.unit!]}` : ''}
        </button>
        <div className="flex justify-between text-xs">
          <button type="button" onClick={onClose} className="text-gray-600 underline">
            Später
          </button>
          {onCancelPlan && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Plan-Ausführung abbrechen? Die Einträge bleiben geplant, die GPS-Spur bleibt gespeichert.')) onCancelPlan()
              }}
              className="text-red-700 underline"
            >
              Ausführung abbrechen
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
