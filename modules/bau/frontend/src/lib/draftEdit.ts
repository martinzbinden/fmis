// Stützpunkte bearbeiten wie in map.geo.admin.ch: ziehen = verschieben, anklicken = löschen,
// auf der Linie ziehen = neuer Punkt (components/DraftLayer.tsx).
import type { LngLat } from '@fmis/core/lv95'
import type { Geom } from './geometry'

export interface XY {
  x: number
  y: number
}

/** Mindestanzahl Stützpunkte je Geometrietyp. */
export const minPoints = (type: Geom['type']) => (type === 'Point' ? 1 : type === 'LineString' ? 2 : 3)

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Einfügeposition für einen neuen Punkt bei `p`: hinter dem Anfang des nächstgelegenen Stücks
 * (bei Flächen zählt auch das Stück vom letzten zum ersten Punkt). Koordinaten in Bildschirmpixeln. */
export function insertIndex(pts: XY[], p: XY, closed: boolean): number {
  const n = closed ? pts.length : pts.length - 1
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best + 1
}

export const insertAt = (draft: LngLat[], index: number, c: LngLat): LngLat[] => [...draft.slice(0, index), c, ...draft.slice(index)]

/** Punkt löschen, solange genug übrig bleiben; sonst null. */
export function removeAt(draft: LngLat[], index: number, type: Geom['type']): LngLat[] | null {
  if (draft.length <= minPoints(type)) return null
  return draft.filter((_, k) => k !== index)
}
