import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import type { PlanParcel } from '../types'
import { colorForKultur } from '../lib/kulturColor'

const BACKGROUND_LAYERS = {
  pixelkarte: { label: 'Pixelkarte', wmtsLayer: 'ch.swisstopo.pixelkarte-farbe', maxZoom: 18 },
  swissimage: { label: 'Luftbild', wmtsLayer: 'ch.swisstopo.swissimage', maxZoom: 20 },
} as const
type BackgroundKey = keyof typeof BACKGROUND_LAYERS

function swisstopoUrl(wmtsLayer: string): string {
  return `https://wmts.geo.admin.ch/1.0.0/${wmtsLayer}/default/current/3857/{z}/{x}/{y}.jpeg`
}

const EMPTY_SELECTION = new Set<string>()
function noop() {}

// leaflet-draw hängt eine Referenz auf das ursprüngliche GeoJSON-Feature
// nicht automatisch an — wir nutzen dafür die von Leaflet für jeden Layer
// bereits vorgesehene (aber lose typisierte) `feature`-Eigenschaft, um
// planId mitzuführen. Siehe onEachLayer unten.
interface PlanFeatureLayer extends L.Layer {
  feature?: { properties: { planId: string } }
}

/**
 * Zeichnen/Editieren/Löschen-Toolbar (leaflet-draw) für den Planungs-
 * Layer. Baut bei jeder Änderung von `planParcels` die editierbare
 * FeatureGroup komplett neu auf (einfacher als Diffing, unkritisch da
 * lokal/offline) und meldet Nutzeraktionen über die drei Callbacks nach
 * aussen — die eigentliche Versionierung passiert dort (lib/planLayer.ts).
 */
function DrawLayer({
  planParcels,
  onCreated,
  onEdited,
  onDeleted,
  onSelect,
  selectionMode,
  selectedIds,
  onToggleSelect,
}: {
  planParcels: PlanParcel[]
  onCreated: (geometry: string) => void
  onEdited: (planId: string, geometry: string) => void
  onDeleted: (planId: string) => void
  onSelect: (planId: string) => void
  /** Auswahl-Modus: Klick auf eine Parzelle togglet ihre Auswahl statt das Detail-Modal zu öffnen. */
  selectionMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (planId: string) => void
}) {
  const map = useMap()
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const layersRef = useRef(new Map<string, L.Layer>())
  const callbacksRef = useRef({ onCreated, onEdited, onDeleted, onSelect, onToggleSelect })
  useEffect(() => {
    callbacksRef.current = { onCreated, onEdited, onDeleted, onSelect, onToggleSelect }
  }, [onCreated, onEdited, onDeleted, onSelect, onToggleSelect])
  // Wie in FieldMap.tsx: per-Feature-Klick-Handler werden einmalig beim
  // (Neu-)Aufbau der FeatureGroup registriert, deshalb aktuellen
  // selectionMode-Wert per Ref verfügbar halten statt als Closure-Wert.
  const selectionModeRef = useRef(selectionMode)
  useEffect(() => {
    selectionModeRef.current = selectionMode
  }, [selectionMode])

  // Toolbar + Event-Handler einmalig aufsetzen.
  useEffect(() => {
    const group = new L.FeatureGroup()
    map.addLayer(group)
    groupRef.current = group

    const control = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: { showArea: true, shapeOptions: { color: '#166534' } },
        marker: false,
        circle: false,
        circlemarker: false,
        polyline: false,
        rectangle: false,
      },
      edit: { featureGroup: group },
    })
    map.addControl(control)

    map.on(L.Draw.Event.CREATED, (e) => {
      const layer = (e as L.DrawEvents.Created).layer
      group.addLayer(layer)
      callbacksRef.current.onCreated(JSON.stringify((layer as L.Polygon).toGeoJSON().geometry))
    })
    map.on(L.Draw.Event.EDITED, (e) => {
      ;(e as L.DrawEvents.Edited).layers.eachLayer((layer) => {
        const planId = (layer as PlanFeatureLayer).feature?.properties.planId
        if (planId) callbacksRef.current.onEdited(planId, JSON.stringify((layer as L.Polygon).toGeoJSON().geometry))
      })
    })
    map.on(L.Draw.Event.DELETED, (e) => {
      ;(e as L.DrawEvents.Deleted).layers.eachLayer((layer) => {
        const planId = (layer as PlanFeatureLayer).feature?.properties.planId
        if (planId) callbacksRef.current.onDeleted(planId)
      })
    })

    return () => {
      // React 18 StrictMode führt Effects im Dev-Modus doppelt aus
      // (mount→cleanup→mount) — ohne dieses .off() blieben die alten
      // map.on(...)-Handler bestehen, und jede Aktion hätte doppelt
      // gefeuert (führte zu doppelten Versionen pro Bearbeitung).
      map.off(L.Draw.Event.CREATED)
      map.off(L.Draw.Event.EDITED)
      map.off(L.Draw.Event.DELETED)
      map.removeControl(control)
      map.removeLayer(group)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  // Bei jeder Änderung der Planungsparzellen die FeatureGroup neu befüllen.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.clearLayers()
    layersRef.current.clear()
    for (const p of planParcels) {
      if (!p.geometry) continue
      const geojsonLayer = L.geoJSON(JSON.parse(p.geometry) as GeoJSON.Geometry as never, {
        style: { color: colorForKultur(p.kultur_code ?? ''), weight: 2, fillOpacity: 0.4 },
      })
      geojsonLayer.eachLayer((layer) => {
        ;(layer as PlanFeatureLayer).feature = { properties: { planId: p.plan_id } }
        layer.bindTooltip(p.kultur_name_de ?? p.flurname ?? 'Ohne Kultur')
        layer.on('click', () => {
          if (selectionModeRef.current) callbacksRef.current.onToggleSelect(p.plan_id)
          else callbacksRef.current.onSelect(p.plan_id)
        })
        layersRef.current.set(p.plan_id, layer)
        group.addLayer(layer)
      })
    }
  }, [planParcels])

  // Ausgewählte Parzellen visuell hervorheben — dickerer, gestrichelter
  // Rand, wie in FieldMap.tsx für die Import-Auswahl.
  useEffect(() => {
    for (const [planId, layer] of layersRef.current.entries()) {
      if (!(layer instanceof L.Path)) continue
      const p = planParcels.find((pp) => pp.plan_id === planId)
      const isSelected = selectedIds.has(planId)
      layer.setStyle({
        color: p ? colorForKultur(p.kultur_code ?? '') : '#166534',
        weight: isSelected ? 5 : 2,
        fillOpacity: isSelected ? 0.6 : 0.4,
        dashArray: isSelected ? '6 4' : undefined,
      })
    }
  }, [selectedIds, planParcels])

  return null
}

export default function PlanningMap({
  planParcels,
  onCreated,
  onEdited,
  onDeleted,
  onSelect,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  focusPlanId,
}: {
  planParcels: PlanParcel[]
  onCreated: (geometry: string) => void
  onEdited: (planId: string, geometry: string) => void
  onDeleted: (planId: string) => void
  onSelect: (planId: string) => void
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (planId: string) => void
  /** Zoomt auf diese Parzelle, wenn gesetzt (z.B. 🌐-Klick in PlanAttributeTable). */
  focusPlanId?: string | null
}) {
  const [background, setBackground] = useState<BackgroundKey>('pixelkarte')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapRef = useRef<L.Map | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const bounds = useMemo(() => {
    const features = planParcels
      .filter((p) => p.geometry)
      .map((p) => ({ type: 'Feature' as const, properties: {}, geometry: JSON.parse(p.geometry!) }))
    if (features.length === 0) return null
    const b = L.geoJSON(features as never).getBounds()
    return b.isValid() ? b : null
  }, [planParcels])

  useEffect(() => {
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: [24, 24] })
  }, [bounds])

  useEffect(() => {
    if (!focusPlanId) return
    const p = planParcels.find((pp) => pp.plan_id === focusPlanId)
    if (!p?.geometry) return
    const b = L.geoJSON(JSON.parse(p.geometry) as never).getBounds()
    if (b.isValid()) mapRef.current?.fitBounds(b, { padding: [24, 24], maxZoom: 18 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPlanId])

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current)
      setTimeout(() => mapRef.current?.invalidateSize(), 50)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void wrapperRef.current?.requestFullscreen()
  }

  function zoomToAll() {
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: [24, 24] })
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
        <DrawLayer
          planParcels={planParcels}
          onCreated={onCreated}
          onEdited={onEdited}
          onDeleted={onDeleted}
          onSelect={onSelect}
          selectionMode={selectionMode}
          selectedIds={selectedIds ?? EMPTY_SELECTION}
          onToggleSelect={onToggleSelect ?? noop}
        />
      </MapContainer>
    </div>
  )
}
