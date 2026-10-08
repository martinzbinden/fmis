import { useMemo, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import Modal from './Modal'
import { ParcelLayer, TILES } from './ParcelPicker'
import { useQuery } from '../hooks/useQuery'
import { getDb } from '../db/pglite'
import { loadFertilizerTypes } from '../lib/fertilization'
import { addDaysIso, fmtArea, num, todayIso, USAGE_TYPE_LABEL } from '../lib/format'
import { computeNutrients, parseDilution } from '../lib/nutrients'
import { amountFor, createPlanEntries, type PlanWork } from '../lib/workPlanEdit'
import type { Parcel } from '../types'

const UNIT: Record<string, string> = { m3: 'm³', t: 't', kg: 'kg' }
// Nutzungen, die man planen kann (Weide läuft über Herden, Aufwuchshöhe ist eine Messung)
const PLAN_USAGE = Object.keys(USAGE_TYPE_LABEL).filter((k) => !['weide', 'aufwuchshoehe'].includes(k))

/** Arbeit im Arbeitsplan planen: Datum, Arbeit (Düngerart oder Nutzung),
 * Parzellen (Liste mit Suche oder Karte), Menge je ha → geplante Einträge
 * (Entwurf) im Wiesenjournal. */
export default function PlanCreateDialog({ seasonYear, onClose, onSaved }: { seasonYear: number; onClose: () => void; onSaved: (date: string) => void }) {
  const { data } = useQuery(
    async (pg) => {
      const [types, parcels] = await Promise.all([
        loadFertilizerTypes(pg),
        pg.query<Parcel>('select * from parcels where season_year = $1 and deleted_at is null order by farm_name nulls last, name', [seasonYear]),
      ])
      return { types, parcels: parcels.rows.map((p) => ({ ...p, area_a: num(p.area_a) as never })) }
    },
    [seasonYear],
  )
  const [date, setDate] = useState(addDaysIso(todayIso(), 1))
  const [workKey, setWorkKey] = useState('')
  const [label, setLabel] = useState('')
  const [rate, setRate] = useState('')
  const [dilution, setDilution] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'liste' | 'karte'>('liste')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)

  const types = data?.types ?? []
  const parcels = data?.parcels ?? []
  const work: PlanWork | null = workKey.startsWith('f:')
    ? (() => {
        const t = types.find((x) => `f:${x.id}` === workKey)
        return t ? { kind: 'fert', type: t } : null
      })()
    : workKey.startsWith('u:')
      ? { kind: 'usage', usageType: workKey.slice(2), label: label.trim() || null }
      : null
  const unit = work?.kind === 'fert' ? work.type.unit : null
  const rateNum = Number(rate.replace(',', '.')) || 0

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const chosen = parcels.filter((p) => selected.has(p.id))
  const amountOf = (p: Parcel) => {
    const o = overrides[p.id]
    if (o != null && o.trim() !== '') return Number(o.replace(',', '.'))
    return rateNum ? amountFor(rateNum, num(p.area_a)) : null
  }
  const total = chosen.reduce((s, p) => s + (amountOf(p) ?? 0), 0)
  const areaA = chosen.reduce((s, p) => s + (num(p.area_a) ?? 0), 0)
  const perHa = work?.kind === 'fert' && rateNum ? computeNutrients(rateNum, work.type, parseDilution(dilution)) : null
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return parcels.filter((p) => !s || [p.name, p.kultur_name_de, p.farm_name].some((v) => (v ?? '').toLowerCase().includes(s)))
  }, [parcels, q])

  async function save() {
    if (!work || !chosen.length) return
    setBusy(true)
    try {
      await createPlanEntries(await getDb(), {
        date,
        seasonYear,
        work,
        parcels: chosen,
        amounts: new Map(chosen.map((p) => [p.id, amountOf(p)])),
        dilution: dilution.trim() || null,
        notes: notes.trim() || null,
      })
      onSaved(date)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
  return (
    <Modal title="Arbeit planen" onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Datum</span>
            <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Arbeit</span>
            <select
              className={field}
              value={workKey}
              onChange={(e) => {
                setWorkKey(e.target.value)
                const t = types.find((x) => `f:${x.id}` === e.target.value)
                setDilution(t?.unit === 'm3' && t.dilution_default && t.dilution_default < 1 ? `1:${Math.round((1 - t.dilution_default) / t.dilution_default)}` : '')
              }}
            >
              <option value="">— wählen —</option>
              <optgroup label="Düngung">
                {types.map((t) => (
                  <option key={t.id} value={`f:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Nutzung / Bearbeitung">
                {PLAN_USAGE.map((k) => (
                  <option key={k} value={`u:${k}`}>
                    {USAGE_TYPE_LABEL[k]}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>

        {work?.kind === 'fert' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Menge je ha ({UNIT[work.type.unit]}/ha)</span>
              <input inputMode="decimal" className={field} value={rate} onChange={(e) => setRate(e.target.value)} placeholder={work.type.unit === 'm3' ? 'z.B. 25' : ''} />
            </label>
            {work.type.unit === 'm3' && (
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700">Verdünnung (Gülle:Wasser)</span>
                <input className={field} value={dilution} onChange={(e) => setDilution(e.target.value)} placeholder="z.B. 1:1" />
              </label>
            )}
            {perHa && (
              <p className="col-span-2 text-xs text-gray-500">
                je ha ≈ {Math.round(perHa.n_kg ?? 0)} kg N ({Math.round(perHa.n_avail_kg ?? 0)} verfügbar) · {Math.round(perHa.p2o5_kg ?? 0)} P₂O₅ ·{' '}
                {Math.round(perHa.k2o_kg ?? 0)} K₂O
              </p>
            )}
          </div>
        )}
        {work?.kind === 'usage' && (
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Bezeichnung (optional)</span>
            <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z.B. Saatmischung, 1. Schnitt" />
          </label>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium text-gray-700">
              Parzellen ({chosen.length}
              {chosen.length ? ` · ${fmtArea(areaA)}` : ''})
            </span>
            <span className="flex gap-1">
              {(['liste', 'karte'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded px-2 py-0.5 text-xs ${tab === t ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
                >
                  {t === 'liste' ? '☰ Liste' : '🗺 Karte'}
                </button>
              ))}
            </span>
          </div>
          {tab === 'liste' ? (
            <>
              <input type="search" className={`${field} mb-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Name, Kultur, Betrieb" />
              <ul className="max-h-52 divide-y overflow-y-auto rounded border border-gray-200">
                {list.map((p) => (
                  <li key={p.id}>
                    <label className={`flex items-center gap-2 px-2 py-1.5 ${selected.has(p.id) ? 'bg-brand-50' : ''}`}>
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-gray-500">{[p.kultur_name_de, p.farm_name].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 text-xs text-gray-600">{fmtArea(num(p.area_a))}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="h-72 overflow-hidden rounded">
              <MapContainer center={[46.92, 7.6]} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer url={TILES} maxZoom={18} attribution="&copy; swisstopo" />
                <ParcelLayer
                  parcels={parcels.map((p) => ({ id: p.id, name: p.name, base_geometry: p.base_geometry, area_a: num(p.area_a), farm_name: p.farm_name }))}
                  selectedId={null}
                  selectedIds={selected}
                  here={null}
                  onPick={toggle}
                />
              </MapContainer>
            </div>
          )}
        </div>

        {work?.kind === 'fert' && chosen.length > 0 && (
          <div className="rounded border border-gray-200">
            <div className="flex justify-between border-b bg-gray-50 px-2 py-1 text-xs text-gray-600">
              <span>Menge je Parzelle (anpassbar)</span>
              <span className="font-semibold">
                Total {Math.round(total * 10) / 10} {UNIT[work.type.unit]}
              </span>
            </div>
            <ul className="max-h-40 divide-y overflow-y-auto">
              {chosen.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="text-sm">
                    {p.name} <span className="text-xs text-gray-500">{fmtArea(num(p.area_a))}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      inputMode="decimal"
                      value={overrides[p.id] ?? (amountOf(p) != null ? String(amountOf(p)) : '')}
                      onChange={(e) => setOverrides({ ...overrides, [p.id]: e.target.value })}
                      className="w-20 rounded border border-gray-300 px-2 py-0.5 text-right"
                    />
                    <span className="w-6 text-xs text-gray-500">{UNIT[work.type.unit]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
          <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={busy || !work || !chosen.length || (unit != null && !total)}
          onClick={() => void save()}
          className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Speichert…' : `${chosen.length || ''} ${chosen.length === 1 ? 'Parzelle' : 'Parzellen'} planen (Entwurf im Wiesenjournal)`}
        </button>
      </div>
    </Modal>
  )
}
