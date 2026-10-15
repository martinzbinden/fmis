import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useQuery } from '../hooks/useQuery'
import { addDaysIso, fmtArea, fmtDate, num, todayIso } from '../lib/format'
import { calibrate, fieldAxis, planSpreading } from '../lib/slurry'
import { isTractor, loadMachines, loadsFor, machineSummary, suggestTractor } from '../lib/machines'
import { completePlan, getActivePlan, loadPlan, setActivePlan, visitedParcels, type ActivePlan, type PlanTask } from '../lib/workPlan'
import { startSession, useTrackingSession } from '../lib/trackingSession'
import { pointsFromTrack } from '../lib/trackFilter'
import { loadTrackTanks } from '../lib/slurryData'
import { deletePlanTask } from '../lib/workPlanEdit'
import PlanCreateDialog from '../components/PlanCreateDialog'
import CompletePlanDialog from '../components/CompletePlanDialog'
import type { Machine, Track } from '../types'

const UNIT: Record<string, string> = { m3: 'm³', t: 't', kg: 'kg' }

async function load(pg: PGlite) {
  // Überfällige Planungen der letzten zwei Wochen mit anzeigen.
  const active = getActivePlan()
  const [tasks, machines, tanks, planTracks] = await Promise.all([
    loadPlan(addDaysIso(todayIso(), -14)),
    loadMachines(pg),
    pg.query<Record<string, unknown>>('select * from tank_events where deleted_at is null order by event_at'),
    // Spuren seit Start der laufenden Ausführung (Fortschritt, Fässer)
    active
      ? pg.query<Track>('select * from tracks where deleted_at is null and started_at >= $1 order by started_at', [active.started_at]).then((r) => r.rows)
      : Promise.resolve([] as Track[]),
  ])
  // Ausfluss je Güllefass, geeicht aus "Fass leer" (lib/slurry.ts)
  const flow = new Map<string, number | null>()
  for (const m of machines.filter((x) => x.kind === 'guellefass')) {
    const ev = tanks.rows
      .filter((t) => t.machine_id === m.id)
      .map((t) => ({ source: t.source as 'knopf' | 'auto', volume_m3: num(t.volume_m3) ?? 0, distance_m: num(t.distance_m) ?? 0, spread_s: num(t.spread_s) ?? 0, width_m: num(t.width_m) ?? 0 }))
    flow.set(m.id, calibrate(ev, m.flow_m3_min ?? null).flowM3Min)
  }
  const planTanks = planTracks.length ? await loadTrackTanks(pg, planTracks.map((t) => t.id)) : []
  return { tasks, machines, flow, planTracks, planTanks }
}

function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

function TaskCard({
  task,
  machines: all,
  flow,
  canTrack,
  canWrite,
  onStart,
  onComplete,
  onDelete,
}: {
  task: PlanTask
  machines: Machine[]
  flow: Map<string, number | null>
  canTrack: boolean
  canWrite: boolean
  onStart: (machine: Machine | null, tractor: Machine | null) => void
  onComplete: () => void
  onDelete: () => void
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
      {canWrite && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <button type="button" onClick={onComplete} className="flex-1 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700">
            ✓ Erledigt erfassen
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Plan «${task.title}» (${task.items.length} ${task.items.length === 1 ? 'Parzelle' : 'Parzellen'}) löschen? Bereits Erledigtes bleibt.`)) onDelete()
            }}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"
          >
            Plan löschen
          </button>
        </div>
      )}
    </div>
  )
}

/** Arbeitsplan aus der Planung im Journal: je Tag, was wo zu tun ist, mit
 * Menge und Anzahl Fässer — und dem Start der GPS-Aufzeichnung. */
export default function WorkPlan() {
  const { data, loading, refresh } = useQuery(load, [])
  const canTrack = useHasPermission('betrieb:tracking:write')
  // Planen und Abschliessen schreiben Journal-Einträge (Nutzung/Düngung)
  const canFert = useHasPermission('wiesenjournal:duengung:write')
  const canUsage = useHasPermission('wiesenjournal:nutzung:write')
  const canWrite = canFert || canUsage
  const [creating, setCreating] = useState(false)
  const [completing, setCompleting] = useState<PlanTask | null>(null)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  const [active, setActive] = useState<ActivePlan | null>(() => getActivePlan())
  const updateActive = (plan: ActivePlan | null) => {
    setActivePlan(plan)
    setActive(plan)
    refresh()
  }
  const session = useTrackingSession()
  const recording = session.track != null
  const [finishing, setFinishing] = useState(false)
  // Nach «Stop» im Tracking (?abschluss=1): Ausführung abschliessen
  useEffect(() => {
    if (params.get('abschluss') !== '1') return
    setParams({}, { replace: true })
    if (active) setFinishing(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  // Befahrene Parzellen: alle Spuren seit Planstart plus laufende Aufzeichnung
  const visited = useMemo(() => {
    if (!active) return new Set<string>()
    const earlier = (data?.planTracks ?? []).flatMap((t) => pointsFromTrack(t.geometry, t.point_times))
    return visitedParcels(active.task.items, [...earlier, ...(recording ? session.points : [])])
  }, [active, data, recording, session.points])
  const tanksByParcel = useMemo(() => {
    const m = new Map<string, { m3: number; count: number }>()
    for (const t of data?.planTanks ?? []) {
      if (!t.parcel_id) continue
      const e = m.get(t.parcel_id) ?? { m3: 0, count: 0 }
      e.m3 = Math.round((e.m3 + t.volume_m3) * 10) / 10
      e.count++
      m.set(t.parcel_id, e)
    }
    return m
  }, [data])

  function record(plan: ActivePlan) {
    const track = startSession(Number(todayIso().slice(0, 4)), {
      label: `${plan.task.title} ${fmtDate(plan.task.date)}`,
      widthM: plan.width_m,
      workType: plan.task.work_type,
      machine: [plan.machine_name, plan.tractor_name].filter(Boolean).join(' + ') || null,
      operator: getCurrentUserEmail(),
      machineId: plan.machine_id,
      tractorId: plan.tractor_id ?? null,
    })
    updateActive({ ...plan, track_id: track.id })
    navigate('../tracking')
  }

  const dates = useMemo(() => [...new Set((data?.tasks ?? []).map((t) => t.date))].sort(), [data])
  const [chosen, setChosen] = useState<string | null>(null)
  const date = chosen ?? dates.find((d) => d >= today) ?? dates.at(-1) ?? null
  const tasks = (data?.tasks ?? []).filter((t) => t.date === date)

  function start(task: PlanTask, machine: Machine | null, tractor: Machine | null) {
    record({
      task,
      machine_id: machine?.id ?? null,
      machine_name: machine?.name ?? null,
      tractor_id: tractor?.id ?? null,
      tractor_name: tractor?.name ?? null,
      width_m: machine?.width_m ?? null,
      started_at: new Date().toISOString(),
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Arbeitsplan</h1>
        <span className="flex items-baseline gap-3">
          <Link to="../maschinen" className="text-sm text-brand-700">
            Maschinen
          </Link>
          {canWrite && (
            <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
              + Arbeit planen
            </button>
          )}
        </span>
      </div>

      {active && (
        <div className={`space-y-2 rounded-lg p-3 text-sm ${recording ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">
              {recording ? '● Läuft auf diesem Gerät' : 'Unterbrochen'}: {active.task.title} · {fmtDate(active.task.date)}
              {active.machine_name ? ` · ${active.machine_name}` : ''}
              {active.tractor_name ? ` + ${active.tractor_name}` : ''}
            </span>
            <span className="text-xs">
              {visited.size} / {active.task.items.length} Parzellen befahren
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-3">
            {active.task.items.map((it) => (
              <li key={it.parcel_id} className={visited.has(it.parcel_id) ? 'font-semibold' : 'opacity-70'}>
                {visited.has(it.parcel_id) ? '✓' : '○'} {it.parcel_name}
                {it.amount != null && it.unit ? ` · ${it.amount} ${UNIT[it.unit] ?? it.unit}` : ''}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {recording ? (
              <button type="button" onClick={() => navigate('../tracking')} className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white">
                🧭 Tracking öffnen
              </button>
            ) : (
              canTrack && (
                <>
                  <button type="button" onClick={() => record(active)} className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white">
                    ▶ Aufzeichnung fortsetzen
                  </button>
                  <button type="button" onClick={() => setFinishing(true)} className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium">
                    Ausführung abschliessen
                  </button>
                </>
              )
            )}
          </div>
        </div>
      )}

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && dates.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">
          Nichts geplant. Mit «+ Arbeit planen» hier planen — oder im Raster einen Tag ab heute öffnen und «Arbeit planen» wählen.
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
        <TaskCard
          flow={data?.flow ?? new Map()}
          key={t.key}
          task={t}
          machines={data?.machines ?? []}
          canTrack={canTrack && !active}
          canWrite={canWrite}
          onStart={(m, tr) => start(t, m, tr)}
          onComplete={() => setCompleting(t)}
          onDelete={() => void deletePlanTask(t).then(refresh)}
        />
      ))}

      {creating && (
        <PlanCreateDialog
          seasonYear={Number(today.slice(0, 4))}
          onClose={() => setCreating(false)}
          onSaved={(d) => {
            setCreating(false)
            setChosen(d)
            refresh()
          }}
        />
      )}
      {finishing && active && (
        <CompletePlanDialog
          task={active.task}
          visited={visited}
          tanks={tanksByParcel}
          onClose={() => setFinishing(false)}
          onCancelPlan={() => {
            updateActive(null)
            setFinishing(false)
          }}
          onDone={async (done, date, amounts) => {
            await completePlan(active, done, date, amounts)
            updateActive(null)
            setFinishing(false)
            refresh()
          }}
        />
      )}
      {completing && (
        <CompletePlanDialog
          task={completing}
          onClose={() => setCompleting(null)}
          onDone={async (done, date, amounts) => {
            await completePlan({ task: completing }, done, date, amounts)
            setCompleting(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}
