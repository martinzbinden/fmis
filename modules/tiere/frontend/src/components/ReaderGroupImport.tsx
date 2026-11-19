import { useEffect, useMemo, useState } from 'react'
import { listAllAnimals, type AnimalRef } from '@fmis/core/animals'
import { API_URL, getToken } from '@fmis/core/auth'
import { syncModuleNow } from '@fmis/core/sync'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { fmtDate, fmtDateTime, todayIso } from '../lib/format'
import { majoritySpecies, planSave, resolveTags } from '../lib/groupScan'
import { constituteGroup, loadHerdData, type HerdData } from '../lib/herds'
import { markPool } from '../lib/readerPools'
import type { HerdGroup } from '../types'
import Modal from './Modal'

interface DeviceGroup {
  group_id: string
  name: string | null
  count: number | null
  imported_at: string | null
  imported_group_id: string | null
}

interface Fetched {
  pool_id: string
  group_id: string
  name: string | null
  count: number | null
  tags: string[]
  unmatched: string[]
  scanned_at: string | null
}

interface Row extends Fetched {
  include: boolean
  newName: string
  milking: boolean
}

const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` })

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/tiere${path}`, { ...init, headers: { ...authHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } })
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `Fehler ${res.status}`)
  return (await res.json()) as T
}

const label = (g: { name: string | null; group_id: string }) => g.name ?? `Gruppe ${g.group_id}`
const field = 'min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base'

/** Gruppen vom Lesegerät (APR600) als Tiergruppen anlegen: erst die Namen am Gerät zeigen und wählen (auch mehrere),
 * dann je Gruppe prüfen (Name, erkannte Tiere, wer aus einer anderen Gruppe wechselt) und alle in einem Schritt anlegen.
 * Braucht den Schalter «Sync» nicht: das Gerät wird genau jetzt kurz abgefragt. */
export default function ReaderGroupImport({ onClose, onDone }: { onClose: () => void; onDone?: (groups: HerdGroup[]) => void }) {
  const [step, setStep] = useState<'pick' | 'review'>('pick')
  const [list, setList] = useState<DeviceGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [data, setData] = useState<HerdData | null>(null)
  const [animals, setAnimals] = useState<AnimalRef[] | null>(null)
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)

  async function loadList() {
    setLoading(true)
    setError(null)
    try {
      const r = await api<{ groups: DeviceGroup[] }>('/reader/groups')
      setList(r.groups)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void loadList()
    void loadHerdData().then(setData)
    void listAllAnimals().then(setAnimals)
  }, [])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (list ?? []).filter((g) => !q || label(g).toLowerCase().includes(q))
  }, [list, filter])

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function fetchPicked() {
    setLoading(true)
    setError(null)
    try {
      // in der Reihenfolge des Geräts
      const ids = (list ?? []).filter((g) => picked.has(g.group_id)).map((g) => g.group_id)
      const r = await api<{ groups: Fetched[]; missing: string[] }>('/reader/groups/fetch', { method: 'POST', body: JSON.stringify({ group_ids: ids }) })
      setRows(r.groups.map((g) => ({ ...g, include: g.tags.length > 0, newName: g.name ?? `Lesegerät ${g.group_id}`, milking: false })))
      setMissing(r.missing)
      setStep('review')
      // die abgelegten Zeilen auf dieses Gerät holen, damit sie nachher als «importiert» markiert werden können
      void syncModuleNow('tiere')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  // Auswertung je Zeile: erkannte Tiere; steht ein Tier in mehreren gewählten Gruppen, gilt die unterste
  const review = useMemo(() => {
    if (!animals || !data) return null
    const resolved = rows.map((r) => resolveTags(r.tags, animals))
    const lastRow = new Map<string, number>()
    rows.forEach((r, i) => {
      if (r.include) for (const m of resolved[i].matched) lastRow.set(m.animal.id, i)
    })
    return rows.map((r, i) => {
      const all = resolved[i].matched.map((m) => m.animal)
      const own = all.filter((a) => lastRow.get(a.id) === i)
      const plan = planSave(data, null, own, date, false)
      const nameClash =
        !!r.newName.trim() &&
        (data.groups.some((g) => g.active && g.name.trim().toLowerCase() === r.newName.trim().toLowerCase()) ||
          rows.some((o, j) => j !== i && o.include && o.newName.trim().toLowerCase() === r.newName.trim().toLowerCase()))
      return { animals: own, elsewhere: all.length - own.length, unknown: resolved[i].unknown.length + r.unmatched.length, species: majoritySpecies(own.length ? own : all), moving: plan.moving, nameClash }
    })
  }, [rows, animals, data, date])

  const chosen = rows.map((r, i) => ({ r, v: review?.[i] })).filter((x) => x.r.include && x.v && x.v.animals.length > 0)
  const canSave = !busy && chosen.length > 0 && chosen.every((x) => x.r.newName.trim() && !x.v!.nameClash)

  async function save() {
    if (!canSave || !data) return
    setBusy(true)
    try {
      const created: HerdGroup[] = []
      await undoAction(`Lesegerät → ${chosen.length === 1 ? `«${chosen[0].r.newName.trim()}»` : `${chosen.length} Tiergruppen`}`, async () => {
        let current = data
        let order = data.groups.length
        for (const { r, v } of chosen) {
          order += 1
          const group: HerdGroup = { id: crypto.randomUUID(), name: r.newName.trim(), species: v!.species, milking: r.milking, active: true, sort_order: order * 10, notes: null, updated_at: '', deleted_at: null }
          await constituteGroup(current, { group, animals: v!.animals, date, replace: false })
          created.push(group)
          // nächste Gruppe mit dem neuen Stand (wer gerade gewechselt hat)
          current = await loadHerdData()
        }
      })
      await syncModuleNow('tiere').catch(() => undefined)
      for (const [i, { r }] of chosen.entries()) await markPool(r.pool_id, 'importiert', created[i].id).catch(() => undefined)
      notifySuccess(created.length === 1 ? `Tiergruppe «${created[0].name}» angelegt` : `${created.length} Tiergruppen angelegt`)
      onDone?.(created)
      onClose()
    } catch (e) {
      notifyError(errorText(e))
      setBusy(false)
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <Modal title={step === 'pick' ? 'Gruppen vom Lesegerät' : 'Als Tiergruppen anlegen'} onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm">
        {error && (
          <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-2 text-amber-900">
            <p>{error}</p>
            <button type="button" onClick={() => void (step === 'pick' && !list ? loadList() : fetchPicked())} className="min-h-11 rounded-lg border border-amber-700 bg-white px-3">
              Nochmals versuchen
            </button>
          </div>
        )}

        {step === 'pick' && (
          <>
            <p className="text-gray-600">Diese Gruppen liegen jetzt im Lesegerät. Wähle die, die du in FMIS als Tiergruppe anlegen willst.</p>
            {loading && !list && <p className="text-gray-500">Frage das Lesegerät ab …</p>}
            {list && list.length === 0 && <p className="text-gray-600">Auf dem Lesegerät liegen keine Gruppen.</p>}
            {list && list.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {list.length > 8 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name suchen" aria-label="Gruppen nach Name filtern" className={`${field} flex-1`} />}
                  <button type="button" onClick={() => setPicked((s) => new Set([...s, ...shown.map((g) => g.group_id)]))} className="min-h-11 rounded-lg border border-gray-300 px-3">
                    Alle
                  </button>
                  <button type="button" onClick={() => setPicked((s) => new Set([...s].filter((id) => !shown.some((g) => g.group_id === id))))} className="min-h-11 rounded-lg border border-gray-300 px-3">
                    Keine
                  </button>
                </div>
                <ul className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                  {shown.map((g) => (
                    <li key={g.group_id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-2 py-1.5">
                        <input type="checkbox" checked={picked.has(g.group_id)} onChange={() => toggle(g.group_id)} className="h-5 w-5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-gray-900">{label(g)}</span>
                          {g.imported_at && <span className="block text-xs text-green-800">schon importiert {fmtDateTime(g.imported_at)}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-gray-600">{g.count ?? '?'} gelesen</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={picked.size === 0 || loading} onClick={() => void fetchPicked()} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
                {loading && list ? 'holt Tiere …' : picked.size === 0 ? 'Gruppen wählen' : `Weiter mit ${picked.size} ${picked.size === 1 ? 'Gruppe' : 'Gruppen'}`}
              </button>
              <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 px-4">
                Abbrechen
              </button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            {missing.length > 0 && <p className="text-amber-800">{missing.length} gewählte Gruppe(n) lagen nicht mehr auf dem Gerät.</p>}
            {!review && <p className="text-gray-500">Lädt Tiere …</p>}
            <ul className="space-y-2">
              {review &&
                rows.map((r, i) => {
                  const v = review[i]
                  const empty = v.animals.length === 0
                  return (
                    <li key={r.pool_id} className={`space-y-1.5 rounded-lg border p-2 ${r.include && !empty ? 'border-brand-300 bg-white' : 'border-gray-200 bg-gray-50'}`}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={r.include && !empty} disabled={empty} onChange={(e) => update(i, { include: e.target.checked })} className="h-5 w-5" />
                        <span className="font-semibold text-gray-900">{label(r)}</span>
                        {r.scanned_at && <span className="ml-auto text-xs text-gray-500">gelesen {fmtDateTime(r.scanned_at)}</span>}
                      </label>
                      <p className="text-gray-800">
                        <b>{v.animals.length}</b> {v.animals.length === 1 ? 'Tier' : 'Tiere'} ({v.species === 'rinder' ? 'Rinder' : 'Schafe'})
                        {v.unknown > 0 && <span className="text-amber-800">, {v.unknown} Ohrmarke{v.unknown === 1 ? '' : 'n'} unbekannt (übersprungen)</span>}
                        {v.elsewhere > 0 && <span className="text-amber-800">, {v.elsewhere} auch in einer weiter unten gewählten Gruppe (kommen dorthin)</span>}
                      </p>
                      {r.include && !empty && (
                        <>
                          <input value={r.newName} onChange={(e) => update(i, { newName: e.target.value })} aria-label={`Name der Tiergruppe für ${label(r)}`} className={field} />
                          {v.nameClash && <p className="text-amber-800">Diesen Namen gibt es schon. Bitte anders benennen (bestehende Gruppe ersetzen geht über «📥 Vom Lesegerät» einzeln).</p>}
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={r.milking} onChange={(e) => update(i, { milking: e.target.checked })} className="h-5 w-5" />
                            gemolkene Gruppe
                          </label>
                          {v.moving.length > 0 && (
                            <p className="text-amber-800">
                              {v.moving.length} {v.moving.length === 1 ? 'wechselt' : 'wechseln'} aus {[...new Set(v.moving.map((m) => `«${m.from.name}»`))].join(', ')}
                            </p>
                          )}
                        </>
                      )}
                      {empty && <p className="text-gray-500">Keine bekannten Tiere – wird nicht angelegt.</p>}
                    </li>
                  )
                })}
            </ul>
            <p className="text-xs text-gray-600">Ein Tier gehört immer nur einer Tiergruppe an: wer schon in einer anderen steht, wechselt in die neue. Alles ist ein Schritt, «Rückgängig» nimmt ihn ganz zurück.</p>
            <label className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Gültig ab</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-2" />
            </label>
            <div className="flex gap-2">
              <button type="button" disabled={!canSave} onClick={() => void save()} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
                {busy ? 'legt an …' : `${chosen.length} ${chosen.length === 1 ? 'Tiergruppe' : 'Tiergruppen'} ab ${fmtDate(date)} anlegen`}
              </button>
              <button type="button" disabled={busy} onClick={() => setStep('pick')} className="min-h-12 rounded-lg border border-gray-300 px-4">
                Zurück
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
