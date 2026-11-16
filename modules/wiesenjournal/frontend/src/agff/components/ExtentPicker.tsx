// Aus fmis components/ExtentPicker.tsx (59425bb), ohne Weidegänge.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import Modal from './Modal'
import MapBase from './MapBase'
import { areaM2, computeShares, prepareParcels, toLv, centerLatLng } from '../lib/geo'
import type { Parcel } from '../types'

// Deutsche Texte für leaflet-draw
function germanDraw() {
  const d = (L as unknown as { drawLocal: Record<string, any> }).drawLocal // eslint-disable-line @typescript-eslint/no-explicit-any
  d.draw.toolbar.buttons.polygon = 'Fläche zeichnen'
  d.draw.toolbar.actions = { title: 'Abbrechen', text: 'Abbrechen' }
  d.draw.toolbar.finish = { title: 'Fertig', text: 'Fertig' }
  d.draw.toolbar.undo = { title: 'Letzten Punkt löschen', text: 'Letzten Punkt löschen' }
  d.draw.handlers.polygon.tooltip = { start: 'Klicken, um zu beginnen.', cont: 'Weiter klicken.', end: 'Ersten Punkt klicken zum Schliessen.' }
  d.edit.toolbar.buttons = { edit: 'Bearbeiten', editDisabled: 'Nichts zu bearbeiten', remove: 'Löschen', removeDisabled: 'Nichts zu löschen' }
  d.edit.toolbar.actions = { save: { title: 'Speichern', text: 'Speichern' }, cancel: { title: 'Abbrechen', text: 'Abbrechen' }, clearAll: { title: 'Alles löschen', text: 'Alles löschen' } }
}

export function DrawOne({ initial, onChange }: { initial: string | null; onChange: (g: string | null) => void }) {
  const map = useMap()
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    germanDraw()
    const group = new L.FeatureGroup()
    map.addLayer(group)
    if (initial) {
      L.geoJSON(JSON.parse(initial) as never, { style: { color: '#b45309', weight: 2, fillOpacity: 0.3 } }).eachLayer((l) => group.addLayer(l))
    }
    const control = new L.Control.Draw({
      position: 'topright',
      draw: { polygon: { showArea: false, shapeOptions: { color: '#b45309' } }, marker: false, circle: false, circlemarker: false, polyline: false, rectangle: false },
      edit: { featureGroup: group },
    })
    map.addControl(control)
    const emit = () => {
      const layers = group.getLayers() as L.Polygon[]
      cb.current(layers.length ? JSON.stringify(layers[layers.length - 1].toGeoJSON().geometry) : null)
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

function Reference({ parcels, focus, onPick }: { parcels: Parcel[]; focus: Parcel; onPick: (g: string, label: string) => void }) {
  const map = useMap()
  useEffect(() => {
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: parcels
          .filter((p) => p.base_geometry)
          .map((p) => ({ type: 'Feature', properties: { label: p.name, id: p.id }, geometry: JSON.parse(p.base_geometry!) })),
      } as never,
      {
        style: (f) => ({ color: f?.properties?.id === focus.id ? '#facc15' : '#e5e7eb', weight: f?.properties?.id === focus.id ? 3 : 1.5, fillOpacity: 0.05 }),
        onEachFeature: (f, l) => {
          l.bindTooltip(`${f.properties.label} · ganze Fläche übernehmen`, { sticky: true })
          l.on('click', () => onPick(JSON.stringify(f.geometry), f.properties.label))
        },
      },
    )
    layer.addTo(map)
    const fl = focus.base_geometry ? L.geoJSON(JSON.parse(focus.base_geometry) as never).getBounds() : layer.getBounds()
    if (fl.isValid()) map.fitBounds(fl, { padding: [40, 40], maxZoom: 18 })
    return () => {
      map.removeLayer(layer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, parcels, focus.id])
  return null
}

export default function ExtentPicker({
  parcel,
  parcels,
  initial,
  onClose,
  onPick,
}: {
  parcel: Parcel
  parcels: Parcel[]
  initial: string | null
  onClose: () => void
  onPick: (geometry: string) => void
}) {
  const [geometry, setGeometry] = useState<string | null>(initial)
  const [picked, setPicked] = useState<string | null>(null)
  const center = useMemo(() => centerLatLng(parcel.base_geometry) ?? [46.95, 7.44], [parcel.base_geometry]) as [number, number]
  const preview = useMemo(() => {
    const g = toLv(geometry)
    if (!g) return null
    try {
      const r = computeShares(g, prepareParcels(parcels))
      return { total: Math.round(areaM2(g)) / 100, shares: r.shares }
    } catch {
      return null
    }
  }, [geometry, parcels])

  return (
    <Modal title={`Gedüngte Fläche · ${parcel.name}`} onClose={onClose} wide>
      <p className="mb-2 text-xs text-gray-500">
        Fläche zeichnen (Werkzeug oben rechts) – z.B. Streifen dem Zaun entlang, nur der obere Teil – oder eine Parzelle antippen, um sie ganz zu
        übernehmen. Die Fläche darf über Parzellengrenzen gehen; die Anteile rechnet das Gerät selbst.
      </p>
      <MapBase className="h-[55vh]" center={center} zoom={17}>
        <Reference parcels={parcels} focus={parcel} onPick={(g, label) => { setGeometry(g); setPicked(label) }} />
        <DrawOne initial={initial} onChange={(g) => { setGeometry(g); setPicked(null) }} />
      </MapBase>
      <div className="mt-2 text-xs text-gray-600">
        {preview ? (
          <>
            {picked ? `Übernommen: ${picked} · ` : ''}
            {preview.total.toFixed(1)} a
            {preview.shares.length > 0 && ` – ${preview.shares.map((s) => `${s.parcel_name} ${s.area_a.toFixed(1)} a`).join(', ')}`}
          </>
        ) : (
          'Noch keine Fläche'
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button type="button" className="btn-primary" disabled={!geometry} onClick={() => geometry && onPick(geometry)}>
          Fläche übernehmen
        </button>
      </div>
    </Modal>
  )
}
