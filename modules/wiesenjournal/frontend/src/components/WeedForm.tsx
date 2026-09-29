import { useState } from 'react'
import Modal from './Modal'
import MiniLocationMap, { type NearbyObservation } from './MiniLocationMap'
import { todayIso, fmtDateTime, WEED_TYPE_LABEL } from '../lib/format'
import type { WeedSeverity, WeedType } from '../types'

const WEED_TYPE_OPTIONS: { value: WeedType; label: string }[] = [
  { value: 'blacken', label: '🌿 Blacken' },
  { value: 'disteln', label: '🌵 Disteln' },
  { value: 'andere', label: '❔ Andere' },
]

const SEVERITY_OPTIONS: { value: WeedSeverity; label: string }[] = [
  { value: 'einzeln', label: 'Einzeln' },
  { value: 'nest', label: 'Nest' },
  { value: 'flaechig', label: 'Flächig' },
]

export interface WeedFormValues {
  weedType: WeedType
  severity: WeedSeverity | null
  treatment: string
  treatedAt: string
  notes: string
}

const DEFAULTS: WeedFormValues = { weedType: 'blacken', severity: null, treatment: '', treatedAt: '', notes: '' }

export default function WeedForm({
  title,
  initial,
  lat,
  lng,
  accuracyM,
  relocating,
  onRelocate,
  nearby,
  onClose,
  onSave,
  onDelete,
  onAdjustPosition,
}: {
  title: string
  initial?: Partial<WeedFormValues>
  lat: number
  lng: number
  accuracyM: number | null
  relocating: boolean
  onRelocate: () => void
  nearby: NearbyObservation[]
  onClose: () => void
  onSave: (values: WeedFormValues) => void
  onDelete?: () => void
  onAdjustPosition: (lat: number, lng: number) => void
}) {
  const [values, setValues] = useState<WeedFormValues>({ ...DEFAULTS, ...initial })

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <MiniLocationMap lat={lat} lng={lng} accuracyM={accuracyM} nearby={nearby} onAdjust={onAdjustPosition} />
          <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              {lat.toFixed(6)}, {lng.toFixed(6)}
              {accuracyM != null && <span className="ml-1">· ±{Math.round(accuracyM)} m</span>}
            </span>
            <button
              type="button"
              onClick={onRelocate}
              disabled={relocating}
              className="rounded px-2 py-1 font-medium text-brand-700 disabled:opacity-50"
            >
              {relocating ? 'Bestimme…' : '📍 Position neu bestimmen'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400">Roter Punkt auf der Karte ziehen, um ihn genau zu setzen.</p>
        </div>

        {nearby.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            <p className="mb-1 font-medium">Bisherige Meldungen in der Nähe</p>
            <ul className="space-y-0.5">
              {nearby.slice(0, 4).map((o) => (
                <li key={o.id}>
                  {WEED_TYPE_LABEL[o.weedType]}
                  {o.severity ? ` · ${o.severity}` : ''} · {fmtDateTime(o.observedAt)} · {Math.round(o.distanceM)} m entfernt
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Art</span>
          <div className="flex gap-2">
            {WEED_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setValues((v) => ({ ...v, weedType: opt.value }))}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  values.weedType === opt.value
                    ? 'border-brand-600 bg-brand-100 text-brand-800'
                    : 'border-gray-300 text-gray-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Befall</span>
          <div className="flex gap-2">
            {SEVERITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setValues((v) => ({ ...v, severity: v.severity === opt.value ? null : opt.value }))}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  values.severity === opt.value
                    ? 'border-brand-600 bg-brand-100 text-brand-800'
                    : 'border-gray-300 text-gray-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Behandlung (optional)</span>
          <input
            type="text"
            placeholder="z.B. gestochen, gespritzt"
            value={values.treatment}
            onChange={(e) => setValues((v) => ({ ...v, treatment: e.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        {values.treatment && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Behandelt am</span>
            <input
              type="date"
              value={values.treatedAt || todayIso()}
              onChange={(e) => setValues((v) => ({ ...v, treatedAt: e.target.value }))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
          <textarea
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            rows={2}
          />
        </label>
        <div className="flex items-center justify-between border-t pt-3">
          {onDelete ? (
            <button type="button" onClick={onDelete} className="rounded-lg px-3 py-1.5 text-sm text-red-600">
              Löschen
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => onSave(values)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
