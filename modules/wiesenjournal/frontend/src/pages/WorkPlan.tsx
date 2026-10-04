import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { addDaysIso, fmtArea, fmtDate, num, todayIso } from '../lib/format'
import { calibrate, fieldAxis, planSpreading } from '../lib/slurry'
import { isTractor, loadMachines, loadsFor, machineSummary, suggestTractor } from '../lib/machines'
import { getActivePlan, loadPlan, setActivePlan, type PlanTask } from '../lib/workPlan'
import type { Machine } from '../types'

const UNIT: Record<string, string> = { m3: 'm³', t: 't', kg: 'kg' }

async function load(pg: PGlite) {
  // Überfällige Planungen der letzten zwei Wochen mit anzeigen.
  const [tasks, machines, tanks] = await Promise.all([
    loadPlan(pg, addDaysIso(todayIso(), -14)),
    loadMachines(pg),
    pg.query<Record<string, unknown>>('select * from tank_events where deleted_at is null order by event_at'),
  ])
  // Ausfluss je Güllefass, geeicht aus "Fass leer" (lib/slurry.ts)
  const flow = new Map<string, number | null>()
  for (const m of machines.filter((x) => x.kind === 'guellefass')) {
    const ev = tanks.rows
      .filter((t) => t.machine_id === m.id)
      .map((t) => ({ source: t.source as 'knopf' | 'auto', volume_m3: num(t.volume_m3) ?? 0, distance_m: num(t.distance_m) ?? 0, spread_s: num(t.spread_s) ?? 0, width_m: num(t.width_m) ?? 0 }))
    flow.set(m.id, calibrate(ev, m.flow_m3_min ?? null).flowM3Min)
  }
  return { tasks, machines, flow }
}

function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

function TaskCard({
  task,
  machines: all,
  flow,
  canTrack,
  onStart,
}: {
  task: PlanTask
  machines: Machine[]
  flow: Map<string, number | null>
  canTrack: boolean
  onStart: (machine: Machine | null, tractor: Machine | null) => void
}) {
  const machines = all.filter((m) => !isTractor(m))
  const tractors = all.filter(isTractor)
  const suitable = machines.filter((m) => task.machine_kinds.includes(m.kind))
  const [machineId, setMachineId] = useState<string>(suitable[0]?.id ?? '')
  const machine = machines.find((m) => m.id === machineId) ?? null
  // Traktor folgt dem Gerät (Standard-Traktor), bis er von Hand gewählt wird.
  const [tractorChoice, setTractorChoice] = useState<string | null>(null)
  const tractorId = tractorChoice ?? suggestTractor(machine, all)?.id ?? ''
  const tractor = tractors.find((t) => t.id === tractorId) ?? null
  const total = task.items.reduce((s, i) => s + (i.amount ?? 0), 0)
  const area = task.items.reduce((s, i) => s + (i.area_a ?? 0), 0)
  const loads = loadsFor(total || null, task.unit, machine)
  const [loadWord, loadShort] = machine?.kind === 'guellefass' ? ['Fässer', 'F.'] : ['Fuhren', 'Fu.']

  return (
    <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <div>
        <div className="text-base font-semibold text-gray-800">{task.title}</div>
        <div className="text-sm text-gray-600">
          {task.items.length} {task.items.length === 1 ? 'Parzelle' : 'Parzellen'} · {fmtArea(area)}
          {total > 0 && task.unit && (
            <>
              {' '}
              · <span className="font-semibold">{total.toLocaleString('de-CH')} {UNIT[task.unit]}</span>
              {loads != null && <span className="font-semibold"> ≈ {loads} {loadWord}</span>}
            </>
          )}
        </div>
      </div>

      <ul className="divide-y text-sm">
        {task.items.map((it) => {
          const itemLoads = loadsFor(it.amount, it.unit, machine)
          // Güllefass: Bahnen je Fass und Geschwindigkeit, damit das Fass am
          // Bahnende leer ist (lib/slurry.ts)
          const axis = fieldAxis(it.geometry)
          const slurry =
            machine?.kind === 'guellefass' && it.unit === 'm3' && it.amount && it.area_a && machine.capacity && machine.width_m
              ? planSpreading({
                  tankM3: machine.capacity,
                  widthM: machine.width_m,
                  flowM3Min: flow.get(machine.id) ?? null,
                  targetM3Ha: it.amount / (it.area_a / 100),
                  fieldLengthM: axis?.lengthM ?? null,
                  areaHa: it.area_a / 100,
                })
              : null
          const best = slurry?.options[0]
          return (
            <li key={it.parcel_id} className="flex items-baseline justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <span className="font-medium text-gray-800">{it.parcel_name}</span>
                <span className="ml-1 text-xs text-gray-500">{fmtArea(it.area_a)}</span>
                {it.notes && <span className="block text-xs text-gray-500">{it.notes}</span>}
                {slurry && it.amount && it.area_a && (
                  <span className="block text-xs text-amber-800">
                    {Math.round(it.amount / (it.area_a / 100))} m³/ha
                    {slurry.speedKmh ? ` bei ${slurry.speedKmh.toFixed(1)} km/h` : ''} · {Math.round(slurry.distPerTankM)} m je Fass
                    {best && axis
                      ? ` · Feld ${axis.lengthM} m: ${best.lanes} ${best.lanes === 1 ? 'Bahn' : 'Bahnen'}/Fass → ${Math.round(best.rateM3Ha)} m³/ha${best.speedKmh ? ` bei ${best.speedKmh.toFixed(1)} km/h` : ''}`
                      : ''}
                  </span>
                )}
              </span>
              {it.amount != null && it.unit && (
                <span className="shrink-0 tabular-nums text-gray-700">
                  {it.amount.toLocaleString('de-CH')} {UNIT[it.unit]}
                  {itemLoads != null && <span className="ml-1 text-xs text-gray-500">({itemLoads} {loadShort})</span>}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {canTrack && (
        <div className="space-y-2 border-t pt-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-gray-500">Maschine</span>
            <select
              value={machineId}
              onChange={(e) => {
                setMachineId(e.target.value)
                setTractorChoice(null)
              }}
              className="w-full rounded border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="">— ohne —</option>
              {(suitable.length ? suitable : machines).map((m) => (
                <option key={m.id} value={m.id}>
                  {machineSummary(m)}
                </option>
              ))}
              {suitable.length > 0 &&
                machines
                  .filter((m) => !suitable.includes(m))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {machineSummary(m)}
                    </option>
                  ))}
            </select>
          </label>
          {tractors.length > 0 && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-gray-500">Traktor</span>
              <select value={tractorId} onChange={(e) => setTractorChoice(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-2 text-sm">
                <option value="">— ohne —</option>
                {tractors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {machineSummary(t)}
                    {machine?.tractor_id === t.id ? ' (Standard)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => onStart(machine, tractor)}
            className="w-full rounded-lg bg-green-600 py-3 text-base font-semibold text-white active:bg-green-700"
          >
            ▶ Ausführung starten
          </button>
          <p className="text-xs text-gray-500">Startet sofort die GPS-Aufzeichnung auf diesem Gerät.</p>
        </div>
      )}
    </div>
  )
}

/** Arbeitsplan aus der Planung im Journal: je Tag, was wo zu tun ist, mit
 * Menge und Anzahl Fässer — und dem Start der GPS-Aufzeichnung. */
export default function WorkPlan() {
  const { data, loading } = useQuery(load, [])
  const canTrack = useHasPermission('wiesenjournal:tracking:write')
  const navigate = useNavigate()
  const today = todayIso()
  const active = getActivePlan()

  const dates = useMemo(() => [...new Set((data?.tasks ?? []).map((t) => t.date))].sort(), [data])
  const [chosen, setChosen] = useState<string | null>(null)
  const date = chosen ?? dates.find((d) => d >= today) ?? dates.at(-1) ?? null
  const tasks = (data?.tasks ?? []).filter((t) => t.date === date)

  function start(task: PlanTask, machine: Machine | null, tractor: Machine | null) {
    setActivePlan({
      task,
      machine_id: machine?.id ?? null,
      machine_name: machine?.name ?? null,
      tractor_id: tractor?.id ?? null,
      tractor_name: tractor?.name ?? null,
      width_m: machine?.width_m ?? null,
      started_at: new Date().toISOString(),
    })
    navigate('../karte?plan=start')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Arbeitsplan</h1>
        <Link to="../maschinen" className="text-sm text-brand-700">
          Maschinen
        </Link>
      </div>

      {active && (
        <Link to="../karte" className="block rounded-lg bg-green-600 p-3 text-sm font-semibold text-white">
          ● Läuft auf diesem Gerät: {active.task.title} ({fmtDate(active.task.date)}) — zur Karte
        </Link>
      )}

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && dates.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">
          Nichts geplant. Im Raster einen Tag ab heute öffnen und «Arbeit planen» wählen — z.B. Gülle mit Menge je Parzelle.
        </p>
      )}

      {dates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setChosen(d)}
              className={`rounded-full px-3 py-1 text-sm ${
                d === date ? 'bg-brand-700 text-white' : d < today ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {d === today ? 'Heute' : weekday(d)}
              {d < today && ' · überfällig'}
            </button>
          ))}
        </div>
      )}

      {tasks.map((t) => (
        <TaskCard flow={data?.flow ?? new Map()} key={t.key} task={t} machines={data?.machines ?? []} canTrack={canTrack && !active} onStart={(m, tr) => start(t, m, tr)} />
      ))}
    </div>
  )
}
