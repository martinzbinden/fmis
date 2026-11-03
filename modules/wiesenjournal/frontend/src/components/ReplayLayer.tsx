import { useEffect, useMemo, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { CATEGORICAL, OTHER } from '../lib/parcelColor'
import { replayState, type ReplaySegment } from '../lib/replay'

/** Farbe je Arbeit: nach gefahrener Zeit, die grösste zuerst; «ohne Angabe» grau. */
export function workColors(segments: ReplaySegment[]): [string, string][] {
  const time = new Map<string, number>()
  for (const s of segments) time.set(s.work, (time.get(s.work) ?? 0) + s.duration)
  const ranked = [...time.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w)
  let slot = 0
  return ranked.map((w) => [w, w === 'ohne Angabe' ? OTHER : (CATEGORICAL[slot++] ?? OTHER)])
}

/** Zeichnet die Spuren bis zur Wiedergabezeit `at`: fertige ganz, die laufende
 * bis zum aktuellen Punkt mit Markierung, spätere noch nicht. */
export default function ReplayLayer({ segments, at, colors }: { segments: ReplaySegment[]; at: number; colors: Map<string, string> }) {
  const map = useMap()
  const lines = useRef<L.Polyline[]>([])
  const marker = useRef<L.CircleMarker | null>(null)
  const group = useMemo(() => L.layerGroup(), [])

  // einmal je Spurliste: Linien anlegen und Ausschnitt setzen
  useEffect(() => {
    group.clearLayers()
    lines.current = segments.map((s) =>
      L.polyline([], { color: colors.get(s.work) ?? OTHER, weight: 4, opacity: 0.85 }).bindTooltip(
        `${s.work} · ${new Date(s.startedAt).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}`,
        { sticky: true },
      ),
    )
    lines.current.forEach((l) => l.addTo(group))
    marker.current = L.circleMarker([0, 0], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#111827', fillOpacity: 1 })
    group.addTo(map)
    const all = segments.flatMap((s) => s.points)
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [20, 20], maxZoom: 17 })
    return () => {
      map.removeLayer(group)
    }
  }, [map, group, segments, colors])

  useEffect(() => {
    const st = replayState(segments, at)
    segments.forEach((s, i) => {
      const l = lines.current[i]
      if (!l) return
      if (i < st.done) l.setLatLngs(s.points)
      else if (i === st.current) l.setLatLngs(s.points.slice(0, st.upTo + 1))
      else l.setLatLngs([])
    })
    const m = marker.current
    if (!m) return
    if (st.current != null) {
      m.setLatLng(segments[st.current].points[st.upTo])
      if (!group.hasLayer(m)) m.addTo(group)
    } else if (group.hasLayer(m)) group.removeLayer(m)
  }, [segments, at, group])

  return null
}
