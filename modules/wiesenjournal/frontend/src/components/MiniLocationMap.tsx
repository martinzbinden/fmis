import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { WEED_TYPE_COLOR, WEED_TYPE_LABEL, fmtDateTime } from '../lib/format'
import type { WeedType, WeedSeverity } from '../types'

// Gleiche swisstopo-Quelle wie PaddockMap.tsx — hier fix Luftbild (Kontext
// für einen Feldpunkt ist ein Foto, keine Pixelkarte).
const SWISSIMAGE_URL = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'

const PIN_ICON = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#dc2626;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

export interface NearbyObservation {
  id: string
  lat: number
  lng: number
  weedType: WeedType
  severity: WeedSeverity | null
  observedAt: string
  distanceM: number
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], map.getZoom())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])
  return null
}

export default function MiniLocationMap({
  lat,
  lng,
  accuracyM,
  nearby,
  onAdjust,
}: {
  lat: number
  lng: number
  accuracyM: number | null
  nearby: NearbyObservation[]
  onAdjust: (lat: number, lng: number) => void
}) {
  const markerRef = useRef<L.Marker | null>(null)

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200" style={{ height: 200 }}>
      <MapContainer center={[lat, lng]} zoom={19} style={{ height: '100%', width: '100%' }} attributionControl={false}>
        <TileLayer url={SWISSIMAGE_URL} maxZoom={20} />
        <Recenter lat={lat} lng={lng} />
        {accuracyM != null && (
          <Circle center={[lat, lng]} radius={accuracyM} pathOptions={{ color: '#2563eb', fillOpacity: 0.1, weight: 1 }} />
        )}
        {nearby.map((o) => (
          <CircleMarker
            key={o.id}
            center={[o.lat, o.lng]}
            radius={5}
            pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: WEED_TYPE_COLOR[o.weedType], fillOpacity: 0.9 }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              {WEED_TYPE_LABEL[o.weedType]}
              {o.severity ? ` · ${o.severity}` : ''} · {fmtDateTime(o.observedAt)} · {Math.round(o.distanceM)} m
            </Tooltip>
          </CircleMarker>
        ))}
        <Marker
          position={[lat, lng]}
          icon={PIN_ICON}
          draggable
          ref={markerRef}
          eventHandlers={{
            dragend: () => {
              const m = markerRef.current
              if (m) {
                const pos = m.getLatLng()
                onAdjust(pos.lat, pos.lng)
              }
            },
          }}
        />
      </MapContainer>
    </div>
  )
}
