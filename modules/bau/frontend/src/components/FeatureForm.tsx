import { useState } from 'react'
import AsyncButton from '@fmis/core/AsyncButton'
import NumberInput from '@fmis/core/NumberInput'
import { CATEGORIES, CATEGORY_ORDER, FEATURE_STATUS_LABEL, FEATURE_STATUS_ORDER } from '../lib/categories'
import { duplicateFeature, removeFeature, saveFeature } from '../lib/data'
import { areaM2, fmtArea, fmtLength, lengthM, parseGeometry } from '../lib/geometry'
import type { BauFeature, FeatureCategory, FeatureStatus, SurveyPoint, Variant } from '../types'

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base'
const label = 'mb-1 block text-xs font-medium text-gray-700'

/** Eigenschaften eines Bauobjekts: Kategorie, Status, Material, Durchmesser, Verlegetiefe, Notiz. */
export default function FeatureForm({
  feature,
  points,
  canWrite,
  onEditGeometry,
  onBack,
  onSurvey,
  onDeleted,
  variants = [],
}: {
  feature: BauFeature
  points: SurveyPoint[]
  /** Varianten des Projekts (leer = keine Auswahl) */
  variants?: Variant[]
  canWrite: boolean
  onEditGeometry: () => void
  onBack: () => void
  onSurvey: () => void
  onDeleted: () => void
}) {
  const [f, setF] = useState({
    label: feature.label ?? '',
    category: feature.category as FeatureCategory,
    status: feature.status as FeatureStatus,
    material: feature.material ?? '',
    diameter: feature.diameter_mm != null ? String(feature.diameter_mm) : '',
    depth: feature.depth_cm != null ? String(feature.depth_cm) : '',
    notes: feature.notes ?? '',
    variant: feature.variant_id ?? '',
  })
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const g = parseGeometry(feature.geometry)
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  const surveyCount = points.filter((p) => p.feature_id === feature.id).length

  const save = async () => {
    await saveFeature(
      feature.project_id,
      {
        category: f.category,
        status: f.status,
        label: f.label.trim() || null,
        geometry: g,
        material: f.material.trim() || null,
        diameter_mm: n(f.diameter),
        depth_cm: n(f.depth),
        notes: f.notes.trim() || null,
        variant_id: f.variant || null,
      },
      feature,
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="min-h-12 rounded-lg px-2 text-sm font-medium text-brand-700">
          ← Liste
        </button>
        <div className="text-right text-xs text-gray-600">
          {g?.type === 'Point' ? 'Punkt' : g?.type === 'Polygon' ? `Fläche ${fmtArea(areaM2(g))} · Umfang ${fmtLength(lengthM(g))}` : `Länge ${fmtLength(lengthM(g))}`}
          {feature.plan_geometry && <div>Planlinie bleibt zum Vergleich erhalten</div>}
        </div>
      </div>

      <label className="block">
        <span className={label}>Bezeichnung</span>
        <input className={field} disabled={!canWrite} value={f.label} onChange={(e) => set({ label: e.target.value })} />
      </label>

      <div>
        <span className={label}>Kategorie</span>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!canWrite}
              onClick={() => set({ category: c })}
              className={`min-h-11 rounded-full border px-3 text-sm ${f.category === c ? 'border-brand-600 bg-brand-100 font-semibold text-brand-800' : 'border-gray-300 text-gray-700'}`}
            >
              {CATEGORIES[c].icon} {CATEGORIES[c].label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={label}>Status</span>
        <div className="flex flex-wrap gap-2">
          {FEATURE_STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!canWrite}
              onClick={() => set({ status: s })}
              className={`min-h-11 rounded-full border px-3 text-sm ${f.status === s ? 'border-brand-600 bg-brand-100 font-semibold text-brand-800' : 'border-gray-300 text-gray-700'}`}
            >
              {FEATURE_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="col-span-3 block sm:col-span-1">
          <span className={label}>Material</span>
          <input className={field} disabled={!canWrite} value={f.material} onChange={(e) => set({ material: e.target.value })} placeholder="PE 100 ND16" />
        </label>
        <label className="block">
          <span className={label}>Durchmesser (mm)</span>
          <NumberInput className={field} disabled={!canWrite} value={f.diameter} onChange={(e) => set({ diameter: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>Verlegetiefe (cm)</span>
          <NumberInput className={field} disabled={!canWrite} value={f.depth} onChange={(e) => set({ depth: e.target.value })} />
        </label>
      </div>

      {variants.length > 0 && (
        <label className="block">
          <span className={label}>Variante</span>
          <select className={field} disabled={!canWrite} value={f.variant} onChange={(e) => set({ variant: e.target.value })}>
            <option value="">alle Varianten (gemeinsam)</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                nur {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className={label}>Notiz</span>
        <textarea className={field} rows={2} disabled={!canWrite} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton onClick={save} className="min-h-12 rounded-lg bg-brand-600 px-5 text-base font-medium text-white disabled:opacity-50">
            Speichern
          </AsyncButton>
          <button type="button" onClick={onEditGeometry} className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm">
            ✏️ Stützpunkte bearbeiten
          </button>
          <button type="button" onClick={onSurvey} className="min-h-12 rounded-lg border border-gray-300 px-3 text-sm">
            📍 Einmessen{surveyCount ? ` (${surveyCount})` : ''}
          </button>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <span className="text-gray-600">Dieselbe Trasse auch als</span>
          <select
            className="min-h-11 rounded border border-gray-300 px-2"
            value=""
            onChange={async (e) => {
              const c = e.target.value as FeatureCategory
              if (!c) return
              await duplicateFeature(feature, c, `${CATEGORIES[c].label} (${feature.label ?? CATEGORIES[feature.category].label})`)
            }}
          >
            <option value="">anlegen: Kategorie …</option>
            {CATEGORY_ORDER.filter((c) => c !== feature.category).map((c) => (
              <option key={c} value={c}>
                {CATEGORIES[c].label}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          <button
            type="button"
            className="min-h-12 rounded-lg px-3 text-red-700"
            onClick={async () => {
              if (!confirm(`«${feature.label ?? CATEGORIES[feature.category].label}» samt ${surveyCount} Messpunkt(en) löschen?`)) return
              await removeFeature(feature, points)
              onDeleted()
            }}
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  )
}
