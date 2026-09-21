import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import { loadCurrentPaddocks } from '../lib/paddock'
import Modal from './Modal'
import type { Paddock, Parcel } from '../types'

const TILE_URL = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'

/** Gezeichnetes Polygon (leaflet-draw) — genau eines; ein neues ersetzt das alte. */
function DrawOne({ initial, onChange }: { initial: string | null; onChange: (geometry: string | null) => void }) {
  const map = useMap()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const group = new L.FeatureGroup()
    map.addLayer(group)
    if (initial) {
      L.geoJSON(JSON.parse(initial) as never, { style: { color: '#b45309', weight: 2, fillOpacity: 0.3 } }).eachLayer((l) =>
        group.addLayer(l),
      )
      const b = group.getBounds()
      if (b.isValid()) map.fitBounds(b, { padding: [20, 20] })
    }
    const control = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: { showArea: true, shapeOptions: { color: '#b45309' } },
        marker: false,
        circle: false,
        circlemarker: false,
        polyline: false,
        rectangle: false,
      },
      edit: { featureGroup: group },
    })
    map.addControl(control)
    const emit = () => {
      const layers = group.getLayers() as L.Polygon[]
      onChangeRef.current(layers.length > 0 ? JSON.stringify(layers[layers.length - 1].toGeoJSON().geometry) : null)
    }
    map.on(L.Draw.Event.CREATED, (e) => {
      group.clearLayers()
      group.addLayer((e as L.DrawEvents.Created).layer)
      emit()
    })
    map.on(L.Draw.Event.EDITED, emit)
    map.on(L.Draw.Event.DELETED, emit)
    return () => {
      map.off(L.Draw.Event.CREATED)
      map.off(L.Draw.Event.EDITED)
      map.off(L.Draw.Event.DELETED)
      map.removeControl(control)
      map.removeLayer(group)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return null
}

/** Parzellen-Umrisse als Orientierung; Klick auf eine Parzelle oder einen Weidegang übernimmt dessen Fläche. */
function ReferenceLayer({
  parcels,
  paddocks,
  focus,
  onPick,
}: {
  parcels: Parcel[]
  paddocks: Paddock[]
  focus: Parcel
  onPick: (geometry: string, label: string) => void
}) {
  const map = useMap()
  useEffect(() => {
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: [
          ...parcels
            .filter((p) => p.base_geometry)
            .map((p) => ({ type: 'Feature', properties: { label: p.name, kind: 'parcel', id: p.id }, geometry: JSON.parse(p.base_geometry!) })),
          ...paddocks.map((pd) => ({
            type: 'Feature',
            properties: { label: `Weidegang ${pd.animal_group ?? ''}`.trim(), kind: 'paddock', id: pd.id },
            geometry: JSON.parse(pd.geometry),
          })),
        ],
      } as never,
      {
        style: (f) =>
          f?.properties?.kind === 'paddock'
            ? { color: '#d97706', weight: 2, dashArray: '2 4', fillOpacity: 0.05 }
            : { color: f?.properties?.id === focus.id ? '#166534' : '#6b7280', weight: f?.properties?.id === focus.id ? 2 : 1, fillOpacity: 0.04 },
        onEachFeature: (f, l) => {
          l.bindTooltip(`${f.properties.label} · übernehmen`, { sticky: true })
          l.on('click', () => onPick(JSON.stringify(f.geometry), f.properties.label))
        },
      },
    )
    layer.addTo(map)
    const focusLayer = focus.base_geometry ? L.geoJSON(JSON.parse(focus.base_geometry) as never) : null
    const b = focusLayer?.getBounds()
    if (b?.isValid()) map.fitBounds(b, { padding: [30, 30] })
    else {
      const all = layer.getBounds()
      if (all.isValid()) map.fitBounds(all, { padding: [20, 20] })
    }
    return () => {
      map.removeLayer(layer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, parcels, paddocks, focus.id])
  return null
}

export default function ExtentPicker({
  parcel,
  parcels,
  seasonYear,
  initial,
  onClose,
  onPick,
}: {
  parcel: Parcel
  parcels: Parcel[]
  seasonYear: number
  initial: string | null
  onClose: () => void
  onPick: (geometry: string) => void
}) {
  const [geometry, setGeometry] = useState<string | null>(initial)
  const [paddocks, setPaddocks] = useState<Paddock[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadCurrentPaddocks(seasonYear).then((rows) => {
      if (!cancelled) setPaddocks(rows)
    })
    return () => {
      cancelled = true
    }
  }, [seasonYear])
  const center = useMemo<[number, number]>(() => {
    try {
      const g = JSON.parse(parcel.base_geometry ?? 'null') as { coordinates?: unknown } | null
      const flat = JSON.stringify(g?.coordinates ?? []).match(/-?\d+\.\d+/g)?.map(Number) ?? []
      if (flat.length >= 2) return [flat[1], flat[0]]
    } catch {
      // Fallback unten
    }
    return [46.79, 7.4]
  }, [parcel.base_geometry])

  return (
    <Modal title={`Gedüngte Fläche · ${parcel.name}`} onClose={onClose}>
      <p className="mb-2 text-xs text-gray-500">
        Polygon zeichnen (Werkzeug oben rechts) — z.B. Streifen dem Zaun entlang, nur Rand, oben/unten — oder
        eine Parzelle bzw. einen Weidegang anklicken, um dessen Fläche zu übernehmen. Die Fläche darf
        GELAN-Grenzen überschreiten; die Anteile je Parzelle werden beim Speichern berechnet (Internet nötig).
      </p>
      <div className="h-[55vh] overflow-hidden rounded-lg">
        <MapContainer center={center} zoom={16} className="h-full w-full" attributionControl={false}>
          <TileLayer url={TILE_URL} maxZoom={20} />
          <ReferenceLayer
            parcels={parcels}
            paddocks={paddocks}
            focus={parcel}
            onPick={(g, label) => {
              setGeometry(g)
              setPicked(label)
            }}
          />
          <DrawOne initial={initial} onChange={(g) => {
            setGeometry(g)
            setPicked(null)
          }} />
        </MapContainer>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{picked ? `Übernommen: ${picked}` : geometry ? 'Polygon gezeichnet' : 'Noch keine Fläche'}</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!geometry}
            onClick={() => geometry && onPick(geometry)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Fläche übernehmen
          </button>
        </div>
      </div>
    </Modal>
  )
}
