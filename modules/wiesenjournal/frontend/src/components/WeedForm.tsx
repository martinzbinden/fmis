import { useState } from 'react'
import Modal from './Modal'
import { todayIso } from '../lib/format'
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
  onClose,
  onSave,
  onDelete,
}: {
  title: string
  initial?: Partial<WeedFormValues>
  onClose: () => void
  onSave: (values: WeedFormValues) => void
  onDelete?: () => void
}) {
  const [values, setValues] = useState<WeedFormValues>({ ...DEFAULTS, ...initial })

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
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
