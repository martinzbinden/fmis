import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { FieldDeclaration } from '../types'
import { fmtArea } from '../lib/format'

// swisstopo-WMTS, kein API-Key nötig (öffentlicher Web-Kartendienst,
// api3.geo.admin.ch) — Pflicht-Attribution "© swisstopo". EPSG:3857
// (Web-Mercator), passt zu Leaflets Standard-CRS.
const BACKGROUND_LAYERS = {
  pixelkarte: { label: 'Pixelkarte', wmtsLayer: 'ch.swisstopo.pixelkarte-farbe', maxZoom: 18 },
  swissimage: { label: 'Luftbild', wmtsLayer: 'ch.swisstopo.swissimage', maxZoom: 20 },
} as const
type BackgroundKey = keyof typeof BACKGROUND_LAYERS

function swisstopoUrl(wmtsLayer: string): string {
  return `https://wmts.geo.admin.ch/1.0.0/${wmtsLayer}/default/current/3857/{z}/{x}/{y}.jpeg`
}

// Stabile, deterministische Farbe je Kultur-Code (kein manuell gepflegtes
// Mapping nötig — der amtliche Kulturartenkatalog hat >100 Codes).
function colorForKultur(code: string): string {
  let hash = 0
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) & 0xffffffff
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 65%, 42%)`
}

interface Feature {
  type: 'Feature'
  properties: { declarationId: string }
  geometry: { type: string; coordinates: unknown }
}

/** Zoomt/zentriert die Karte auf die aktuell sichtbaren Parzellen. */
function FitToFeatures({ features }: { features: Feature[] }) {
  const map = useMap()
  useEffect(() => {
    if (features.length === 0) return
    const bounds = L.geoJSON(features as never).getBounds()
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, map])
  return null
}

export default function FieldMap({
  declarations,
  farmNameById,
}: {
  declarations: FieldDeclaration[]
  farmNameById: Map<string, string>
}) {
  const [background, setBackground] = useState<BackgroundKey>('pixelkarte')
  const byId = useMemo(() => new Map(declarations.map((d) => [d.id, d])), [declarations])

  const features = useMemo<Feature[]>(
    () =>
      declarations
        .filter((d) => d.geometry)
        .map((d) => ({
          type: 'Feature',
          properties: { declarationId: d.id },
          geometry: JSON.parse(d.geometry!),
        })),
    [declarations],
  )

  return (
    <div className="overflow-hidden rounded-lg bg-white shadow-sm">
      <div className="flex gap-2 border-b p-2 text-xs">
        {(Object.entries(BACKGROUND_LAYERS) as [BackgroundKey, (typeof BACKGROUND_LAYERS)[BackgroundKey]][]).map(
          ([key, cfg]) => (
            <button
              key={key}
              type="button"
              onClick={() => setBackground(key)}
              className={`rounded px-2 py-1 font-medium ${
                background === key ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {cfg.label}
            </button>
          ),
        )}
      </div>
      <MapContainer center={[46.92, 7.6]} zoom={13} style={{ height: 480, width: '100%' }}>
        <TileLayer
          key={background}
          url={swisstopoUrl(BACKGROUND_LAYERS[background].wmtsLayer)}
          maxZoom={BACKGROUND_LAYERS[background].maxZoom}
          attribution="&copy; swisstopo"
        />
        {features.length > 0 && (
          <GeoJSON
            key={features.map((f) => f.properties.declarationId).join(',')}
            data={{ type: 'FeatureCollection', features } as never}
            style={(feature) => {
              const decl = byId.get((feature?.properties as { declarationId: string }).declarationId)
              return { color: decl ? colorForKultur(decl.kultur_code) : '#666', weight: 1, fillOpacity: 0.45 }
            }}
            pointToLayer={(feature, latlng) => {
              const decl = byId.get((feature.properties as { declarationId: string }).declarationId)
              return L.circleMarker(latlng, {
                radius: 6,
                color: decl ? colorForKultur(decl.kultur_code) : '#666',
                fillOpacity: 0.7,
              })
            }}
            onEachFeature={(feature, layer) => {
              const decl = byId.get((feature.properties as { declarationId: string }).declarationId)
              if (!decl) return
              layer.bindPopup(
                `<strong>${decl.flurname ?? decl.kultur_name_de ?? decl.kultur_code}</strong><br/>` +
                  `${decl.kultur_name_de ?? decl.kultur_code} (${decl.kultur_code})<br/>` +
                  `${fmtArea(decl.area_a)}<br/>` +
                  `${farmNameById.get(decl.farm_id) ?? ''}`,
              )
            }}
          />
        )}
        <FitToFeatures features={features} />
      </MapContainer>
    </div>
  )
}
