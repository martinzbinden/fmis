import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import { colorForKultur } from '@fmis/fields/lib/kulturColor'
import 'leaflet-draw/dist/leaflet.draw.css'
import LocateControl from '@fmis/core/LocateControl'
import { loadFieldsBackground, type FieldsBackgroundFeature } from '../lib/fieldsBackground'
import { WEED_TYPE_COLOR, WEED_TYPE_LABEL } from '../lib/format'
import type { TrackPoint } from '../lib/tracking'
import type { Paddock, Parcel, Track, WeedObservation } from '../types'

const BACKGROUND_LAYERS = {
  pixelkarte: { label: 'Pixelkarte', wmtsLayer: 'ch.swisstopo.pixelkarte-farbe', maxZoom: 18 },
  swissimage: { label: 'Luftbild', wmtsLayer: 'ch.swisstopo.swissimage', maxZoom: 20 },
} as const
type BackgroundKey = keyof typeof BACKGROUND_LAYERS

function swisstopoUrl(wmtsLayer: string): string {
  return `https://wmts.geo.admin.ch/1.0.0/${wmtsLayer}/default/current/3857/{z}/{x}/{y}.jpeg`
}

interface PaddockFeatureLayer extends L.Layer {
  feature?: { properties: { paddockId: string } }
}

/** Freiform Zeichnen/Editieren/Löschen (leaflet-draw) für die aktuell angezeigten Weidegänge. */
function DrawLayer({
  paddocks,
  onCreated,
  onEdited,
  onDeleted,
  onSelect,
}: {
  paddocks: Paddock[]
  onCreated: (geometry: string) => void
  onEdited: (paddockId: string, geometry: string) => void
  onDeleted: (paddockId: string) => void
  onSelect: (paddockId: string) => void
}) {
  const map = useMap()
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const callbacksRef = useRef({ onCreated, onEdited, onDeleted, onSelect })
  useEffect(() => {
    callbacksRef.current = { onCreated, onEdited, onDeleted, onSelect }
  }, [onCreated, onEdited, onDeleted, onSelect])

  useEffect(() => {
    const group = new L.FeatureGroup()
    map.addLayer(group)
    groupRef.current = group

    const control = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: { showArea: true, shapeOptions: { color: '#d97706' } },
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
        const paddockId = (layer as PaddockFeatureLayer).feature?.properties.paddockId
        if (paddockId) callbacksRef.current.onEdited(paddockId, JSON.stringify((layer as L.Polygon).toGeoJSON().geometry))
      })
    })
    map.on(L.Draw.Event.DELETED, (e) => {
      ;(e as L.DrawEvents.Deleted).layers.eachLayer((layer) => {
        const paddockId = (layer as PaddockFeatureLayer).feature?.properties.paddockId
        if (paddockId) callbacksRef.current.onDeleted(paddockId)
      })
    })

    return () => {
      map.off(L.Draw.Event.CREATED)
      map.off(L.Draw.Event.EDITED)
      map.off(L.Draw.Event.DELETED)
      map.removeControl(control)
      map.removeLayer(group)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.clearLayers()
    for (const p of paddocks) {
      const geojsonLayer = L.geoJSON(JSON.parse(p.geometry) as GeoJSON.Geometry as never, {
        style: { color: '#d97706', weight: 2, fillOpacity: 0.35 },
      })
      geojsonLayer.eachLayer((layer) => {
        ;(layer as PaddockFeatureLayer).feature = { properties: { paddockId: p.paddock_id } }
        layer.bindTooltip(p.animal_group ?? 'Weidegang')
        layer.on('click', () => callbacksRef.current.onSelect(p.paddock_id))
        group.addLayer(layer)
      })
    }
  }, [paddocks])

  return null
}

/** Rein lesende Referenz-Umrisse (parcels.base_geometry = GELAN-Parzellen):
 * Futterflächen grau gestrichelt (nicht massgeblich für den Zaun, nur
 * Orientierung), Ackerkulturen — nur mit Umschalter sichtbar — in der
 * Kulturfarbe des Kulturen-Moduls, damit sie sich vom Grünland abheben. */
function BaseGeometryLayer({ parcels }: { parcels: Parcel[] }) {
  const map = useMap()
  useEffect(() => {
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: parcels
          .filter((p) => p.base_geometry)
          .map((p) => ({
            type: 'Feature',
            properties: { name: p.name, category: p.category, kultur: p.kultur_name_de, code: p.kultur_code },
            geometry: JSON.parse(p.base_geometry!),
          })),
      } as never,
      {
        style: (feature) =>
          feature?.properties?.category === 'acker'
            ? { color: colorForKultur(feature.properties.code ?? ''), weight: 1.5, fillOpacity: 0.18 }
            : { color: '#6b7280', weight: 1, dashArray: '4 3', fillOpacity: 0.05 },
        interactive: false,
        onEachFeature: (feature, l) => {
          const props = feature.properties as { name: string; kultur: string | null }
          l.bindTooltip([props.name, props.kultur].filter(Boolean).join(' · '), { sticky: true, direction: 'top' })
        },
      },
    )
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, parcels])
  return null
}

/** Optionale Vorlage aus dem Kulturen-Modul: dotted Referenzlayer, Klick übernimmt die Geometrie 1:1 als neuen Weidegang. */
function FieldsTemplateLayer({ onAdopt }: { onAdopt: (geometry: string, label: string) => void }) {
  const map = useMap()
  const [features, setFeatures] = useState<FieldsBackgroundFeature[]>([])
  useEffect(() => {
    loadFieldsBackground().then(setFeatures)
  }, [])
  useEffect(() => {
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: features.map((f) => ({
          type: 'Feature',
          properties: { id: f.id, label: f.flurname ?? f.kulturName ?? 'Parzelle' },
          geometry: JSON.parse(f.geometry),
        })),
      } as never,
      {
        style: { color: '#0ea5e9', weight: 1, dashArray: '2 4', fillOpacity: 0.03 },
        onEachFeature: (feature, l) => {
          const label = (feature.properties as { label: string }).label
          l.bindTooltip(`${label} · als Weidegang übernehmen`)
          l.on('click', () => onAdopt(JSON.stringify(feature.geometry), label))
        },
      },
    )
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, features, onAdopt])
  return null
}

/** Vergangene (abgeschlossene) Tracks als dünne Linien, plus die gerade
 * laufende Aufzeichnung live in Rot — Tracks sind nicht nutzer-editiert
 * (anders als paddocks), deshalb reines L.polyline statt leaflet-draw. */
function TracksLayer({ tracks, livePoints }: { tracks: Track[]; livePoints: TrackPoint[] | null }) {
  const map = useMap()
  useEffect(() => {
    const group = L.layerGroup()
    for (const t of tracks) {
      if (!t.geometry) continue
      const geo = JSON.parse(t.geometry) as { coordinates: [number, number][] }
      const latlngs = geo.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
      L.polyline(latlngs, { color: '#7c3aed', weight: 3, opacity: 0.55 })
        .bindTooltip(t.label ?? 'Track')
        .addTo(group)
    }
    group.addTo(map)
    return () => {
      map.removeLayer(group)
    }
  }, [map, tracks])

  useEffect(() => {
    if (!livePoints || livePoints.length < 2) return
    const latlngs = livePoints.map((p) => [p.lat, p.lng] as [number, number])
    const line = L.polyline(latlngs, { color: '#dc2626', weight: 4 }).addTo(map)
    return () => {
      map.removeLayer(line)
    }
  }, [map, livePoints])

  return null
}

/** Unkraut-Beobachtungen als kleine farbige Punkte (Farbe nach Art), Klick öffnet die Bearbeitung. */
function WeedMarkersLayer({
  observations,
  onSelect,
}: {
  observations: WeedObservation[]
  onSelect: (observation: WeedObservation) => void
}) {
  const map = useMap()
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  useEffect(() => {
    const group = L.layerGroup()
    for (const o of observations) {
      const geo = JSON.parse(o.geometry) as { coordinates: [number, number] }
      const [lng, lat] = geo.coordinates
      const color = WEED_TYPE_COLOR[o.weed_type] ?? '#6b7280'
      const marker = L.circleMarker([lat, lng], { radius: 6, color, fillColor: color, fillOpacity: 0.85, weight: 1 })
      marker.bindTooltip(`${WEED_TYPE_LABEL[o.weed_type] ?? o.weed_type}${o.treatment ? ' · behandelt' : ''}`)
      marker.on('click', () => onSelectRef.current(o))
      marker.addTo(group)
    }
    group.addTo(map)
    return () => {
      map.removeLayer(group)
    }
  }, [map, observations])
  return null
}

/** Aktiv nur solange `active` — nimmt den nächsten Kartenklick entgegen
 * (Fallback für den Unkraut-Knopf, wenn kein GPS-Fix vorliegt). */
function MapClickCatcher({ active, onPick }: { active: boolean; onPick: (lat: number, lng: number) => void }) {
  const map = useMap()
  const activeRef = useRef(active)
  activeRef.current = active
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  useEffect(() => {
    function handler(e: L.LeafletMouseEvent) {
      if (activeRef.current) onPickRef.current(e.latlng.lat, e.latlng.lng)
    }
    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [map])
  return null
}

export default function PaddockMap({
  paddocks,
  parcels,
  tracks,
  livePoints,
  weedObservations,
  pickingLocation = false,
  onCreated,
  onEdited,
  onDeleted,
  onSelect,
  onAdoptFieldsGeometry,
  onLocationFound,
  onWeedSelect,
  onPickLocation,
}: {
  paddocks: Paddock[]
  parcels: Parcel[]
  tracks: Track[]
  livePoints: TrackPoint[] | null
  weedObservations: WeedObservation[]
  /** Wenn true: der nächste Kartenklick wird an onPickLocation gemeldet statt normal verarbeitet. */
  pickingLocation?: boolean
  onCreated: (geometry: string) => void
  onEdited: (paddockId: string, geometry: string) => void
  onDeleted: (paddockId: string) => void
  onSelect: (paddockId: string) => void
  onAdoptFieldsGeometry: (geometry: string, label: string) => void
  onLocationFound?: (lat: number, lng: number) => void
  onWeedSelect: (observation: WeedObservation) => void
  onPickLocation?: (lat: number, lng: number) => void
}) {
  const [background, setBackground] = useState<BackgroundKey>('pixelkarte')
  const [showTemplate, setShowTemplate] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const mapRef = useRef<L.Map | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const bounds = useMemo(() => {
    const geometries = [
      ...paddocks.map((p) => p.geometry),
      ...parcels.map((p) => p.base_geometry).filter((g): g is string => !!g),
    ]
    if (geometries.length === 0) return null
    const features = geometries.map((g) => ({ type: 'Feature' as const, properties: {}, geometry: JSON.parse(g) }))
    const b = L.geoJSON(features as never).getBounds()
    return b.isValid() ? b : null
  }, [paddocks, parcels])

  useEffect(() => {
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: [24, 24] })
  }, [bounds])

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
          onClick={() => setShowTemplate((v) => !v)}
          title="Parzellen aus dem Kulturen-Modul als Vorlage einblenden — anklicken übernimmt die Fläche 1:1 als Weidegang"
          className={`rounded px-2 py-1 font-medium ${showTemplate ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          Kulturen-Vorlage
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true })}
          title="Auf meinen Standort zoomen"
          className="rounded bg-gray-100 px-2 py-1 font-medium text-gray-600"
        >
          📍 Mein Standort
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
        <BaseGeometryLayer parcels={parcels} />
        {showTemplate && <FieldsTemplateLayer onAdopt={onAdoptFieldsGeometry} />}
        <DrawLayer paddocks={paddocks} onCreated={onCreated} onEdited={onEdited} onDeleted={onDeleted} onSelect={onSelect} />
        <TracksLayer tracks={tracks} livePoints={livePoints} />
        <WeedMarkersLayer observations={weedObservations} onSelect={onWeedSelect} />
        <LocateControl onLocationFound={onLocationFound} />
        {onPickLocation && <MapClickCatcher active={pickingLocation} onPick={onPickLocation} />}
      </MapContainer>
      {pickingLocation && (
        <div className="border-t bg-amber-50 p-2 text-center text-xs font-medium text-amber-800">
          Tippe auf die Karte, um den Standort zu wählen…
        </div>
      )}
    </div>
  )
}
