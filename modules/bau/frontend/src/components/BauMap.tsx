import { useEffect, useMemo, useState } from 'react'
import { Circle, CircleMarker, GeoJSON, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, WMSTileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BACKGROUND_LAYERS, CADASTRE_WMS, SWISSTOPO_ATTRIBUTION, swisstopoUrl, type BackgroundKey } from '@fmis/core/swisstopo'
import { fmtLv95, wgs84ToLv95, type LngLat } from '@fmis/core/lv95'
import { loadFieldsBackground, type FieldsBackgroundFeature } from '@fmis/wiesenjournal/lib/fieldsBackground'
import { CATEGORIES } from '../lib/categories'
import { boundsOf, parseGeometry, type Geom } from '../lib/geometry'
import { accuracyClass } from '../lib/survey'
import type { Fix } from '../lib/useGeolocation'
import type { BauFeature, SurveyPoint } from '../types'

export type MapMode = 'view' | 'draw' | 'edit' | 'measure'

export interface MapLayers {
  cadastre: boolean
  cultures: boolean
  labels: boolean
  points: boolean
  discarded: boolean
}

const ll = (c: LngLat): [number, number] => [c[1], c[0]]

function featureIcon(f: BauFeature, selected: boolean): L.DivIcon {
  const m = CATEGORIES[f.category]
  const size = selected ? 36 : 28
  const square = f.category === 'schacht'
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:${square ? '6px' : '50%'};background:#fff;border:3px solid ${m.color};display:flex;align-items:center;justify-content:center;font-size:${selected ? 18 : 14}px;box-shadow:0 1px 4px rgba(0,0,0,.4)">${m.icon}</div>`,
  })
}

const vertexIcon = (n: number, touch: boolean) =>
  L.divIcon({
    className: '',
    iconSize: [touch ? 30 : 20, touch ? 30 : 20],
    iconAnchor: [touch ? 15 : 10, touch ? 15 : 10],
    html: `<div style="width:100%;height:100%;border-radius:50%;background:#fff;border:3px solid #0e7490;display:flex;align-items:center;justify-content:center;font:700 10px sans-serif;color:#0e7490">${n}</div>`,
  })

const midIcon = (touch: boolean) =>
  L.divIcon({
    className: '',
    iconSize: [touch ? 22 : 14, touch ? 22 : 14],
    iconAnchor: [touch ? 11 : 7, touch ? 11 : 7],
    html: '<div style="width:100%;height:100%;border-radius:50%;background:rgba(14,116,144,.35);border:2px solid #0e7490"></div>',
  })

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function FitBounds({ bounds, fitKey }: { bounds: [[number, number], [number, number]] | null; fitKey: string }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])
  return null
}

function FlyTo({ target }: { target: { lat: number; lng: number; zoom?: number; n: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom ?? Math.max(map.getZoom(), 18), { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.n])
  return null
}

function MapEvents({ onClick, onZoom, onCursor }: { onClick: (c: LngLat) => void; onZoom: (z: number) => void; onCursor: (c: LngLat) => void }) {
  const map = useMapEvents({
    click: (e) => onClick([e.latlng.lng, e.latlng.lat]),
    zoomend: () => onZoom(map.getZoom()),
    mousemove: (e) => !isTouch() && onCursor([e.latlng.lng, e.latlng.lat]),
    move: () => isTouch() && onCursor([map.getCenter().lng, map.getCenter().lat]),
  })
  useEffect(() => {
    const c = map.getCenter()
    onCursor([c.lng, c.lat])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export default function BauMap({
  features,
  points,
  selectedId,
  onSelect,
  mode,
  draft,
  onDraftChange,
  draftType,
  background,
  layers,
  position,
  fitKey,
  flyTo,
  measure,
  onMeasure,
  onCursor,
}: {
  features: BauFeature[]
  points: SurveyPoint[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  mode: MapMode
  /** Entwurf beim Zeichnen/Bearbeiten (Länge/Länge der Stützpunkte) */
  draft: LngLat[]
  onDraftChange: (coords: LngLat[]) => void
  draftType: Geom['type']
  background: BackgroundKey
  layers: MapLayers
  position: Fix | null
  fitKey: string
  flyTo: { lat: number; lng: number; zoom?: number; n: number } | null
  /** Messpunkte der Distanzmessung (Zustand liegt in der Seite, damit «Hier messen» ihn ergänzen kann) */
  measure: LngLat[]
  onMeasure: (coords: LngLat[]) => void
  /** Zeiger (Desktop) bzw. Kartenmitte (Touch) — für «Hier setzen» */
  onCursor: (c: LngLat) => void
}) {
  const touch = isTouch()
  const [zoom, setZoom] = useState(16)
  const [cursor, setCursor] = useState<LngLat | null>(null)
  const [cultures, setCultures] = useState<FieldsBackgroundFeature[]>([])

  useEffect(() => {
    if (layers.cultures && cultures.length === 0) void loadFieldsBackground().then(setCultures)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.cultures])

  const shown = useMemo(() => features.filter((f) => layers.discarded || f.status !== 'verworfen'), [features, layers.discarded])
  const bounds = useMemo(() => boundsOf(features.map((f) => parseGeometry(f.geometry))), [features])
  const bg = BACKGROUND_LAYERS[background]

  function onClick(c: LngLat) {
    // Auf dem Handy setzt «Hier setzen» die Kartenmitte (der Finger verdeckt die Stelle)
    if (mode === 'measure') !touch && onMeasure([...measure, c])
    else if (mode === 'draw') !touch && onDraftChange(draftType === 'Point' ? [c] : [...draft, c])
    else if (mode === 'view') onSelect(null)
  }

  const editing = mode === 'edit'
  const showLabel = layers.labels && zoom >= 17
  const selected = features.find((f) => f.id === selectedId) ?? null

  return (
    <div className="absolute inset-0">
      <MapContainer center={[46.787, 7.4]} zoom={16} maxZoom={bg.maxZoom} zoomControl={false} className="h-full w-full" attributionControl>
        <TileLayer key={background} url={swisstopoUrl(bg.wmtsLayer)} maxZoom={bg.maxZoom} maxNativeZoom={bg.maxZoom} attribution={SWISSTOPO_ATTRIBUTION} />
        {/* Der Dienst liefert die Kantonskarte DECKEND (weisser Hintergrund, `transparent`
            wird ignoriert) — «multiplizieren» lässt Weiss durch und behält nur Linien/Farben. */}
        {layers.cadastre && (
          <WMSTileLayer url={CADASTRE_WMS.url} layers={CADASTRE_WMS.layers} format="image/png" transparent version="1.3.0" opacity={0.9} className="mix-blend-multiply" attribution={CADASTRE_WMS.attribution} />
        )}
        {layers.cultures &&
          cultures.map((c) => {
            const g = parseGeometry(c.geometry)
            return g && g.type === 'Polygon' ? (
              <Polygon key={c.id} positions={g.coordinates.map((r) => r.map(ll))} pathOptions={{ color: '#16a34a', weight: 1, fillOpacity: 0.12, dashArray: '4 4' }} interactive={false}>
                {showLabel && c.flurname && <Tooltip permanent direction="center" className="!bg-transparent !border-0 !shadow-none text-[10px] text-green-900">{c.flurname}</Tooltip>}
              </Polygon>
            ) : null
          })}

        <MapEvents
          onClick={onClick}
          onZoom={setZoom}
          onCursor={(c) => {
            setCursor(c)
            onCursor(c)
          }}
        />
        <FitBounds bounds={bounds} fitKey={fitKey} />
        <FlyTo target={flyTo} />

        {shown.map((f) => {
          const g = parseGeometry(f.geometry)
          if (!g || (editing && f.id === selectedId)) return null
          const meta = CATEGORIES[f.category]
          const isSel = f.id === selectedId
          const faded = f.status === 'verworfen'
          const style: L.PathOptions = {
            color: meta.color,
            weight: meta.width + (isSel ? 3 : 1),
            opacity: faded ? 0.35 : 1,
            dashArray: f.status === 'geplant' ? '9 7' : undefined,
            fillOpacity: faded ? 0.08 : 0.25,
          }
          const handlers = { click: (e: L.LeafletMouseEvent) => { if (mode === 'view') { L.DomEvent.stopPropagation(e); onSelect(f.id) } } }
          const label = showLabel && f.label ? <Tooltip permanent direction="top" className="!text-[11px] !px-1 !py-0">{f.label}</Tooltip> : null
          if (g.type === 'Point')
            return (
              <Marker key={f.id} position={ll(g.coordinates)} icon={featureIcon(f, isSel)} interactive={mode === 'view'} eventHandlers={handlers}>
                {label}
              </Marker>
            )
          if (g.type === 'LineString')
            return (
              <Polyline key={f.id} positions={g.coordinates.map(ll)} pathOptions={style} interactive={mode === 'view'} eventHandlers={handlers}>
                {label}
              </Polyline>
            )
          return (
            <Polygon key={f.id} positions={g.coordinates.map((r) => r.map(ll))} pathOptions={style} interactive={mode === 'view'} eventHandlers={handlers}>
              {label}
            </Polygon>
          )
        })}

        {/* Planlinie des gewählten, eingemessenen Objekts zum Vergleich Soll/Ist */}
        {selected?.plan_geometry &&
          (() => {
            const g = parseGeometry(selected.plan_geometry)
            if (!g || g.type === 'Point') return null
            return <Polyline positions={(g.type === 'LineString' ? g.coordinates : g.coordinates[0]).map(ll)} pathOptions={{ color: '#9ca3af', weight: 3, dashArray: '2 8' }} interactive={false} />
          })()}

        {layers.points &&
          points.map((p) => {
            const cls = accuracyClass(p.accuracy_m)
            const color = cls === 'gut' ? '#16a34a' : cls === 'ok' ? '#ca8a04' : cls === 'schlecht' ? '#dc2626' : '#6b7280'
            return (
              <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }} interactive={false}>
                {zoom >= 18 && <Tooltip permanent direction="right" offset={[6, 0]} className="!text-[10px] !px-1 !py-0">{`P${String(p.point_no).padStart(3, '0')}`}</Tooltip>}
              </CircleMarker>
            )
          })}

        {/* Entwurf: Zeichnen oder Stützpunkte bearbeiten */}
        {(mode === 'draw' || mode === 'edit') && draft.length > 0 && (
          <>
            {draftType !== 'Point' && draft.length > 1 && (
              draftType === 'Polygon' ? <Polygon positions={draft.map(ll)} pathOptions={{ color: '#0e7490', weight: 3, dashArray: '6 6', fillOpacity: 0.15 }} interactive={false} /> : <Polyline positions={draft.map(ll)} pathOptions={{ color: '#0e7490', weight: 4, dashArray: '6 6' }} interactive={false} />
            )}
            {draft.map((c, i) => (
              <Marker
                key={`v${i}-${editing ? c.join() : ''}`}
                position={ll(c)}
                icon={vertexIcon(i + 1, touch)}
                draggable={editing}
                eventHandlers={{
                  dragend: (e) => {
                    const p = (e.target as L.Marker).getLatLng()
                    onDraftChange(draft.map((x, k) => (k === i ? ([p.lng, p.lat] as LngLat) : x)))
                  },
                }}
              >
                {editing && draftType !== 'Point' && (
                  <Popup>
                    <button
                      type="button"
                      className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white"
                      onClick={() => draft.length > (draftType === 'Polygon' ? 3 : 2) && onDraftChange(draft.filter((_, k) => k !== i))}
                    >
                      Stützpunkt {i + 1} entfernen
                    </button>
                  </Popup>
                )}
              </Marker>
            ))}
            {/* Zwischenpunkte: antippen fügt einen Stützpunkt ein */}
            {editing &&
              draftType !== 'Point' &&
              draft.slice(0, draftType === 'Polygon' ? draft.length : draft.length - 1).map((c, i) => {
                const n = draft[(i + 1) % draft.length]
                const mid: LngLat = [(c[0] + n[0]) / 2, (c[1] + n[1]) / 2]
                return (
                  <Marker
                    key={`m${i}`}
                    position={ll(mid)}
                    icon={midIcon(touch)}
                    eventHandlers={{ click: () => onDraftChange([...draft.slice(0, i + 1), mid, ...draft.slice(i + 1)]) }}
                  />
                )
              })}
          </>
        )}

        {mode === 'measure' && measure.length > 0 && (
          <>
            <Polyline positions={measure.map(ll)} pathOptions={{ color: '#111827', weight: 3, dashArray: '2 6' }} interactive={false} />
            {measure.map((c, i) => <CircleMarker key={i} center={ll(c)} radius={4} pathOptions={{ color: '#111827', fillColor: '#fff', fillOpacity: 1 }} interactive={false} />)}
          </>
        )}

        {position && (
          <>
            {position.accuracy != null && <Circle center={[position.lat, position.lng]} radius={position.accuracy} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.12 }} interactive={false} />}
            <CircleMarker center={[position.lat, position.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }} interactive={false} />
          </>
        )}
      </MapContainer>

      {/* Fadenkreuz: auf dem Handy zeigt die Kartenmitte die Koordinate */}
      {touch && (mode === 'draw' || mode === 'measure') && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-1/2 text-2xl text-cyan-700">＋</div>
      )}
      {cursor && (
        <div className="pointer-events-none absolute left-2 top-2 z-[500] rounded bg-white/90 px-2 py-1 font-mono text-[11px] text-gray-800 shadow">
          {(() => {
            const [e, n] = wgs84ToLv95(cursor)
            return `E ${fmtLv95(e, 0)} · N ${fmtLv95(n, 0)}`
          })()}
        </div>
      )}
    </div>
  )
}

