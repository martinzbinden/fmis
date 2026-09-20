import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { FieldDeclaration } from '../types'
import { fmtArea } from '../lib/format'
import { colorForKultur } from '../lib/kulturColor'

// Einzelbäume/Hochstammfeldobstbäume (Kronendurchmesser ca. 3m) liegen im
// Raumdatenexport uneinheitlich vor: teils als Punkt-Geometrie (Layer
// lnf_nutzung_punkt, z.B. "Einheimische standortgerechte Einzelbäume und
// Alleen"), teils als winzige Polygon-Fläche, die die Baumkrone umreisst
// (z.B. "Hochstammfeldobstbäume", area_a rundet auf 0.00). Beide Formen
// überdecken bei normaler Betriebsübersicht die ganze Karte, wenn sie
// als fixe Marker/Flächen dargestellt werden — deshalb werden sie erst
// ab diesem Zoom-Level überhaupt gerendert.
const MIN_ZOOM_FOR_TREES = 17
// Flächen unter diesem Wert (in Aren) gelten als Einzelbaum-Fläche statt
// echter Kulturfläche — deutlich kleiner als die kleinsten realen
// Feldsplitter (die liegen typischerweise bei 0.02a und mehr).
const TREE_SCALE_AREA_A = 0.01

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

interface Feature {
  type: 'Feature'
  properties: { declarationId: string }
  geometry: { type: string; coordinates: unknown }
}

/**
 * Zoomt/zentriert die Karte auf die aktuell sichtbaren Parzellen — oder,
 * falls über die Fruchtfolge-Ansicht eine bestimmte Parzelle angesprungen
 * wurde (focusLineageId), enger auf nur deren Feature(s), mit offenem
 * Popup. Ist die Ziel-Parzelle im aktuellen Jahr/Filter nicht vorhanden,
 * fällt es auf alle sichtbaren Features zurück.
 */
function FitToFeatures({
  features,
  focusFeatureIds,
  popupsRef,
}: {
  features: Feature[]
  focusFeatureIds: Set<string> | null
  popupsRef: React.MutableRefObject<Map<string, L.Layer>>
}) {
  const map = useMap()
  useEffect(() => {
    if (features.length === 0) return
    const focused =
      focusFeatureIds && focusFeatureIds.size > 0
        ? features.filter((f) => focusFeatureIds.has(f.properties.declarationId))
        : []
    const target = focused.length > 0 ? focused : features
    const bounds = L.geoJSON(target as never).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: focused.length > 0 ? 18 : undefined })
    }
    if (focused.length > 0) {
      const layer = popupsRef.current.get(focused[0].properties.declarationId)
      layer?.openPopup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, focusFeatureIds, map])
  return null
}

/** Meldet Zoom-Änderungen nach aussen (für die Einzelbaum-Sichtbarkeit). */
function TrackZoom({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  return null
}

export default function FieldMap({
  declarations,
  farmNameById,
  focusLineageId,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: {
  declarations: FieldDeclaration[]
  farmNameById: Map<string, string>
  focusLineageId?: string | null
  /** Auswahl-Modus: Klick auf eine Parzelle togglet ihre Auswahl statt das Info-Popup zu öffnen. */
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (declarationId: string) => void
}) {
  const [background, setBackground] = useState<BackgroundKey>('pixelkarte')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [zoom, setZoom] = useState(13)
  const byId = useMemo(() => new Map(declarations.map((d) => [d.id, d])), [declarations])
  const popupsRef = useRef(new Map<string, L.Layer>())
  const layersRef = useRef(new Map<string, { layer: L.Layer; popupHtml: string }>())
  const mapRef = useRef<L.Map | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Aktuelle Werte per Ref verfügbar halten, damit die einmal in
  // onEachFeature registrierten Leaflet-Click-Handler (kein Re-Mount bei
  // jedem Render) nicht auf veralteten Closures hängen bleiben.
  const selectionModeRef = useRef(selectionMode)
  useEffect(() => {
    selectionModeRef.current = selectionMode
  }, [selectionMode])
  const onToggleSelectRef = useRef(onToggleSelect)
  useEffect(() => {
    onToggleSelectRef.current = onToggleSelect
  }, [onToggleSelect])

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

  // Einzelbäume (Punkt-Geometrien oder winzige Krondurchmesser-Polygone,
  // siehe TREE_SCALE_AREA_A) erst ab MIN_ZOOM_FOR_TREES anzeigen — echte
  // Kulturflächen sind davon nicht betroffen.
  const visibleFeatures = useMemo(
    () =>
      features.filter((f) => {
        if (zoom >= MIN_ZOOM_FOR_TREES) return true
        if (f.geometry.type === 'Point') return false
        const areaA = byId.get(f.properties.declarationId)?.area_a
        return areaA == null || areaA >= TREE_SCALE_AREA_A
      }),
    [features, zoom, byId],
  )

  const focusFeatureIds = useMemo(() => {
    if (!focusLineageId) return null
    const ids = declarations.filter((d) => d.lineage_id === focusLineageId).map((d) => d.id)
    return ids.length > 0 ? new Set(ids) : null
  }, [declarations, focusLineageId])

  // Popups im Auswahl-Modus deaktivieren (kein Aufpoppen beim Klicken zum
  // Auswählen) und beim Verlassen wieder herstellen.
  useEffect(() => {
    for (const { layer, popupHtml } of layersRef.current.values()) {
      if (selectionMode) layer.unbindPopup()
      else layer.bindPopup(popupHtml)
    }
  }, [selectionMode])

  // Ausgewählte Parzellen visuell hervorheben.
  useEffect(() => {
    for (const [id, { layer }] of layersRef.current.entries()) {
      if (!(layer instanceof L.Path)) continue
      const decl = byId.get(id)
      const isSelected = selectedIds?.has(id) ?? false
      layer.setStyle({
        color: decl ? colorForKultur(decl.kultur_code) : '#666',
        weight: isSelected ? 4 : 1,
        fillOpacity: isSelected ? 0.65 : 0.45,
        dashArray: isSelected ? '6 4' : undefined,
      })
    }
  }, [selectedIds, byId])

  useEffect(() => {
    function handleFullscreenChange() {
      const active = document.fullscreenElement === wrapperRef.current
      setIsFullscreen(active)
      // Leaflet misst die Kartengrösse beim Erstellen — nach einer
      // Grössenänderung (Vollbild rein/raus) muss neu gemessen werden,
      // sonst bleiben Teile der Karte grau/abgeschnitten.
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void wrapperRef.current?.requestFullscreen()
    }
  }

  function zoomToAll() {
    if (features.length === 0) return
    const bounds = L.geoJSON(features as never).getBounds()
    if (bounds.isValid()) mapRef.current?.fitBounds(bounds, { padding: [24, 24] })
  }

  return (
    <div ref={wrapperRef} className="overflow-hidden rounded-lg bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b p-2 text-xs">
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
        <button
          type="button"
          onClick={zoomToAll}
          title="Auf Gesamtbetrieb zoomen"
          className="rounded bg-gray-100 px-2 py-1 font-medium text-gray-600"
        >
          Gesamtbetrieb
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Vollbild verlassen' : 'Vollbild'}
          className="ml-auto rounded bg-gray-100 px-2 py-1 font-medium text-gray-600"
        >
          {isFullscreen ? '⤡' : '⤢'}
        </button>
      </div>
      <MapContainer
        ref={mapRef}
        center={[46.92, 7.6]}
        zoom={13}
        style={{ height: isFullscreen ? 'calc(100vh - 41px)' : 480, width: '100%' }}
      >
        <TileLayer
          key={background}
          url={swisstopoUrl(BACKGROUND_LAYERS[background].wmtsLayer)}
          maxZoom={BACKGROUND_LAYERS[background].maxZoom}
          attribution="&copy; swisstopo"
        />
        <TrackZoom onZoom={setZoom} />
        {visibleFeatures.length > 0 && (
          <GeoJSON
            key={visibleFeatures.map((f) => f.properties.declarationId).join(',')}
            data={{ type: 'FeatureCollection', features: visibleFeatures } as never}
            style={(feature) => {
              const decl = byId.get((feature?.properties as { declarationId: string }).declarationId)
              return { color: decl ? colorForKultur(decl.kultur_code) : '#666', weight: 1, fillOpacity: 0.45 }
            }}
            pointToLayer={(feature, latlng) => {
              const decl = byId.get((feature.properties as { declarationId: string }).declarationId)
              // Realer Radius (Meter) statt fixer Pixelgrösse — Kreis
              // skaliert damit organisch mit dem Zoom (~3m Kronendurchmesser).
              return L.circle(latlng, {
                radius: 1.5,
                color: decl ? colorForKultur(decl.kultur_code) : '#666',
                fillOpacity: 0.7,
              })
            }}
            onEachFeature={(feature, layer) => {
              const decl = byId.get((feature.properties as { declarationId: string }).declarationId)
              if (!decl) return
              popupsRef.current.set(decl.id, layer)
              const popupHtml =
                `<strong>${decl.flurname ?? decl.kultur_name_de ?? decl.kultur_code}</strong><br/>` +
                `${decl.kultur_name_de ?? decl.kultur_code} (${decl.kultur_code})<br/>` +
                `${fmtArea(decl.area_a)}<br/>` +
                `${farmNameById.get(decl.farm_id) ?? ''}`
              layersRef.current.set(decl.id, { layer, popupHtml })
              if (!selectionModeRef.current) layer.bindPopup(popupHtml)
              layer.on('click', () => {
                if (selectionModeRef.current) onToggleSelectRef.current?.(decl.id)
              })
            }}
          />
        )}
        <FitToFeatures features={features} focusFeatureIds={focusFeatureIds} popupsRef={popupsRef} />
      </MapContainer>
    </div>
  )
}
