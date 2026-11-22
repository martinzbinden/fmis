// Farbe des Deckgurts (Farbstift am Widder bzw. Stier). Gewechselt wird nach etwa einem Zyklus, damit man am Tier sieht,
// in welcher Runde es gedeckt wurde: eine Aue mit der neuen Farbe über der alten hat umgerauscht.
//
// Die «momentan gültige Farbe» eines Vatertiers ist die Farbe seiner letzten Meldung mit Farbe; «seit» ist der Beginn
// dieser Farbe (erste Meldung in der ununterbrochenen Folge gleicher Farbe). Ab einem Zyklus seit Beginn schlägt die
// Erfassung die nächste Farbe vor.

export type MarkerColor = 'blau' | 'gruen' | 'rot' | 'violett'

export const MARKER_COLORS: { key: MarkerColor; label: string; swatch: string; ring: string }[] = [
  { key: 'blau', label: 'blau', swatch: 'bg-blue-600', ring: 'ring-blue-600' },
  { key: 'gruen', label: 'grün', swatch: 'bg-green-600', ring: 'ring-green-600' },
  { key: 'rot', label: 'rot', swatch: 'bg-red-600', ring: 'ring-red-600' },
  { key: 'violett', label: 'violett', swatch: 'bg-violet-600', ring: 'ring-violet-600' },
]

export const isMarkerColor = (v: unknown): v is MarkerColor => MARKER_COLORS.some((c) => c.key === v)
export const markerLabel = (c: MarkerColor) => MARKER_COLORS.find((x) => x.key === c)!.label
export const nextMarkerColor = (c: MarkerColor): MarkerColor => MARKER_COLORS[(MARKER_COLORS.findIndex((x) => x.key === c) + 1) % MARKER_COLORS.length].key

/** Zykluslänge in Tagen: danach ist ein Farbwechsel fällig (Schaf 17, Rind 21). */
export const CYCLE_DAYS = { sheep: 17, cattle: 21 } as const

export interface MarkerMating {
  sire_key: string | null
  service_date: string
  marker_color: string | null
}

export interface CurrentMarker {
  color: MarkerColor
  since: string
}

/** Gültige Farbe eines Vatertiers aus seinen Meldungen; null ohne Meldung mit Farbe. */
export function currentMarker(matings: MarkerMating[], sireKey: string | null): CurrentMarker | null {
  if (!sireKey) return null
  const own = matings
    .filter((m): m is MarkerMating & { marker_color: MarkerColor } => m.sire_key === sireKey && isMarkerColor(m.marker_color))
    .sort((a, b) => a.service_date.localeCompare(b.service_date))
  const last = own.at(-1)
  if (!last) return null
  let since = last.service_date
  for (let i = own.length - 1; i >= 0 && own[i].marker_color === last.marker_color; i--) since = own[i].service_date
  return { color: last.marker_color, since }
}
