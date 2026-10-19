import { useState } from 'react'
import Modal from './Modal'
import { CATEGORIES, CATEGORY_ORDER } from '../lib/categories'
import type { Geom } from '../lib/geometry'
import type { FeatureCategory } from '../types'

export interface NewObjectSpec {
  category: FeatureCategory
  label: string
  type: Geom['type']
}

const DEFAULT_TYPE: Record<FeatureCategory, Geom['type']> = {
  guelle: 'LineString',
  strom: 'LineString',
  wasser: 'LineString',
  abwasser: 'LineString',
  drainage: 'LineString',
  kommunikation: 'LineString',
  leerrohr: 'LineString',
  gebaeude: 'Polygon',
  schacht: 'Point',
  sonstiges: 'LineString',
}
const TYPE_LABEL: Record<Geom['type'], string> = { LineString: 'Linie', Point: 'Punkt', Polygon: 'Fläche' }

/** Neues Bauobjekt: Kategorie, Bezeichnung, Geometrieart — danach wird auf der Karte gezeichnet. */
export default function NewObjectDialog({ onClose, onStart }: { onClose: () => void; onStart: (s: NewObjectSpec) => void }) {
  const [category, setCategory] = useState<FeatureCategory>('guelle')
  const [type, setType] = useState<Geom['type']>('LineString')
  const [label, setLabel] = useState('')
  const pick = (c: FeatureCategory) => {
    setCategory(c)
    setType(DEFAULT_TYPE[c])
  }
  return (
    <Modal title="Neues Objekt zeichnen" onClose={onClose} onSubmit={() => onStart({ category, label: label.trim() || CATEGORIES[category].label, type })}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pick(c)}
              className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left text-sm ${category === c ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-gray-300'}`}
            >
              <span aria-hidden>{CATEGORIES[c].icon}</span>
              {CATEGORIES[c].label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(Object.keys(TYPE_LABEL) as Geom['type'][]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`min-h-12 flex-1 rounded-lg border text-sm ${type === t ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-gray-300'}`}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <label className="block text-xs font-medium text-gray-700">
          Bezeichnung
          <input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={CATEGORIES[category].label} />
        </label>
        <button
          type="button"
          onClick={() => onStart({ category, label: label.trim() || CATEGORIES[category].label, type })}
          className="min-h-12 w-full rounded-lg bg-brand-600 text-base font-medium text-white"
        >
          Auf der Karte zeichnen
        </button>
      </div>
    </Modal>
  )
}
