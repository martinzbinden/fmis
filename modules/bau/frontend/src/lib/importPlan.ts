// KML/GeoJSON-Import: nur ergänzen, nie ersetzen oder löschen. Was schon im
// Projekt liegt (gleicher Name und gleiche Geometrie), wird übersprungen —
// ein zweiter Import derselben Datei ergibt 0 neue Objekte.

import { parseGeometry, stringifyGeometry } from './geometry'
import type { ImportedFeature } from './kml'
import type { BauFeature } from '../types'

const round = (n: number) => Math.round(n * 1e7) / 1e7

const key = (label: string | null, geometryText: string | null): string => {
  const g = parseGeometry(geometryText)
  if (!g) return `${label ?? ''}|`
  const norm = JSON.stringify(g, (_k, v) => (typeof v === 'number' ? round(v) : v))
  return `${(label ?? '').trim().toLowerCase()}|${norm}`
}

export function planImport(existing: Pick<BauFeature, 'label' | 'geometry'>[], imported: ImportedFeature[]) {
  const have = new Set(existing.map((f) => key(f.label, f.geometry)))
  const toAdd: ImportedFeature[] = []
  const skipped: ImportedFeature[] = []
  for (const f of imported) {
    const k = key(f.label, stringifyGeometry(f.geometry))
    if (have.has(k)) skipped.push(f)
    else {
      have.add(k) // doppelte Einträge innerhalb derselben Datei ebenfalls nur einmal
      toAdd.push(f)
    }
  }
  return { toAdd, skipped }
}
