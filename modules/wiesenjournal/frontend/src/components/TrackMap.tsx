import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TILES } from './ParcelPicker'
import { lanePoint, lanesCovering, type GuideRef } from '../lib/guidance'
import type { LatLng } from '../lib/geo'

export interface MapTrack {
  id: string
  points: LatLng[]
  widthM: number | null
  color: string
}
export interface MapField {
  id: string
  name: string
  geometry: string
}

/** Meter je Bildschirmpixel (Web-Mercator). */
const mpp = (zoom: number, lat: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom

function ring(geometry: string): LatLng[] {
  try {
    const g = JSON.parse(geometry) as { type: string; coordinates: unknown }
    const r = g.type === 'Polygon' ? (g.coordinates as [number, number][][])[0] : (g.coordinates as [number, number][][][])[0][0]
    return r.map(([lng, lat]) => ({ lat, lng }))
  } catch {
    return []
  }
}

function Layers({
  fields,
  hereId,
  tracks,
  guide,
  position,
  follow,
}: {
  fields: MapField[]
  hereId: string | null
  tracks: MapTrack[]
  guide: { ref: GuideRef; widthM: number; worked: Set<number>; current: number | null } | null
  position: { lat: number; lng: number; accuracyM: number | null } | null
  follow: boolean
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useEffect(() => {
    const on = () => setZoom(map.getZoom())
    map.on('zoomend', on)
    return () => {
      map.off('zoomend', on)
    }
  }, [map])

  // erstes Ausrichten: Spuren, sonst Position, sonst Felder
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    const pts = tracks.flatMap((t) => t.points)
    const all = pts.length ? pts : position ? [position] : fields.flatMap((f) => ring(f.geometry))
    if (!all.length) return
    fitted.current = true
    if (all.length === 1) map.setView([all[0].lat, all[0].lng], 17)
    else map.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number])).pad(0.15))
  }, [map, tracks, position, fields])

  useEffect(() => {
    if (follow && position) map.panTo([position.lat, position.lng], { animate: true })
  }, [map, follow, position])

  useEffect(() => {
    const group = L.layerGroup().addTo(map)
    const lat = map.getCenter().lat
    const px = (m: number) => Math.max(2, m / mpp(zoom, lat))
    for (const f of fields) {
      const r = ring(f.geometry)
      if (r.length) L.polygon(r.map((p) => [p.lat, p.lng] as [number, number]), { color: f.id === hereId ? '#1d4ed8' : '#15803d', weight: f.id === hereId ? 2.5 : 1, fillOpacity: 0.06 }).bindTooltip(f.name).addTo(group)
    }
    if (guide) {
      const field = fields.find((f) => f.id === hereId) ?? null
      const area = field ? ring(field.geometry) : tracks.flatMap((t) => t.points)
      for (const l of lanesCovering(guide.ref, area, guide.widthM)) {
        const a = lanePoint(guide.ref, l.lane, guide.widthM, l.from - 10)
        const b = lanePoint(guide.ref, l.lane, guide.widthM, l.to + 10)
        const isCur = l.lane === guide.current
        L.polyline(
          [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          { color: guide.worked.has(l.lane) ? '#16a34a' : isCur ? '#047857' : '#64748b', weight: isCur ? 2.5 : 1, dashArray: l.lane === 0 ? undefined : '6 6', opacity: 0.9 },
        )
          .bindTooltip(`Bahn ${l.lane}`)
          .addTo(group)
      }
      if (guide.ref.a && guide.ref.b) {
        for (const [p, t] of [
          [guide.ref.a, 'A'],
          [guide.ref.b, 'B'],
        ] as const)
          L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div style="background:#0369a1;color:#fff;border-radius:9px;width:18px;height:18px;font:700 11px/18px sans-serif;text-align:center">${t}</div>` }) }).addTo(group)
      }
    }
    for (const t of tracks) {
      if (t.points.length < 2) continue
      const ll = t.points.map((p) => [p.lat, p.lng] as [number, number])
      // bearbeitete Fläche: Linie so breit wie das Gerät
      if (t.widthM) L.polyline(ll, { color: t.color, weight: px(t.widthM), opacity: 0.28, lineCap: 'butt', lineJoin: 'round' }).addTo(group)
      L.polyline(ll, { color: t.color, weight: 2, opacity: 0.95 }).addTo(group)
    }
    if (position) {
      if (position.accuracyM) L.circle([position.lat, position.lng], { radius: position.accuracyM, color: '#2563eb', weight: 1, fillOpacity: 0.1 }).addTo(group)
      L.circleMarker([position.lat, position.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(group)
    }
    return () => {
      map.removeLayer(group)
    }
  }, [map, zoom, fields, hereId, tracks, guide, position])
  return null
}

/** Karte für Tracking und frühere Spuren: Parzellen, Bahnen der Nulllinie,
 * Spur mit Gerätebreite als Fläche, Position mit GPS-Genauigkeit. */
export default function TrackMap(props: {
  fields: MapField[]
  hereId?: string | null
  tracks: MapTrack[]
  guide?: { ref: GuideRef; widthM: number; worked: Set<number>; current: number | null } | null
  position?: { lat: number; lng: number; accuracyM: number | null } | null
  follow?: boolean
  className?: string
}) {
  return (
    <div className={props.className ?? 'h-full w-full'}>
      <MapContainer center={[46.92, 7.6]} zoom={15} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer url={TILES} maxZoom={19} maxNativeZoom={18} attribution="&copy; swisstopo" />
        <Layers
          fields={props.fields}
          hereId={props.hereId ?? null}
          tracks={props.tracks}
          guide={props.guide ?? null}
          position={props.position ?? null}
          follow={props.follow ?? false}
        />
      </MapContainer>
    </div>
  )
}
