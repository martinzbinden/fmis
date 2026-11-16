import { useEffect, useState, type ReactNode } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BACKGROUND_LAYERS, SWISSTOPO_ATTRIBUTION, swisstopoUrl, type BackgroundKey } from '../lib/swisstopo'
import Standort from './Standort'

const BG_KEY = 'journal_map_bg'

function readBg(): BackgroundKey {
  try {
    const v = localStorage.getItem(BG_KEY)
    if (v && v in BACKGROUND_LAYERS) return v as BackgroundKey
  } catch {
    // Standard
  }
  return 'swissimage'
}

/** Passt die Karte einmal auf die übergebenen Grenzen an. */
export function FitBounds({ bounds, deps }: { bounds: L.LatLngBoundsExpression | null; deps: unknown[] }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds) return
    const b = L.latLngBounds(bounds as L.LatLngBoundsLiteral)
    if (b.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 18 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return null
}

/** Grundkarte mit swisstopo-Hintergrund und Umschalter. */
export default function MapBase({
  children,
  className = 'h-[60vh]',
  center = [46.95, 7.44],
  zoom = 13,
}: {
  children?: ReactNode
  className?: string
  center?: [number, number]
  zoom?: number
}) {
  const [bg, setBg] = useState<BackgroundKey>(readBg)
  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      <MapContainer center={center} zoom={zoom} maxZoom={20} className="h-full w-full" attributionControl>
        <TileLayer
          key={bg}
          url={swisstopoUrl(bg)}
          maxZoom={BACKGROUND_LAYERS[bg].maxZoom}
          maxNativeZoom={BACKGROUND_LAYERS[bg].maxZoom}
          attribution={SWISSTOPO_ATTRIBUTION}
          // CORS statt opaker Antworten: nur so speichert der Service Worker die Kachel (sw-kacheln.js)
          crossOrigin="anonymous"
        />
        {children}
        <Standort />
      </MapContainer>
      <div className="absolute bottom-6 left-2 z-[1000] flex overflow-hidden rounded bg-white/90 text-xs shadow">
        {(Object.keys(BACKGROUND_LAYERS) as BackgroundKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setBg(k)
              try {
                localStorage.setItem(BG_KEY, k)
              } catch {
                // egal
              }
            }}
            className={`px-2 py-1 ${bg === k ? 'bg-brand-700 text-white' : 'text-gray-700'}`}
          >
            {BACKGROUND_LAYERS[k].label}
          </button>
        ))}
      </div>
    </div>
  )
}
