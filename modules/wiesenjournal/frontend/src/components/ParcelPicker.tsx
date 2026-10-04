import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import Modal from './Modal'

export interface PickParcel {
  id: string
  name: string
  base_geometry: string | null
  area_a: number | null
  farm_name: string | null
  kultur_name_de?: string | null
  bff?: boolean
}

const fmtA = (a: number | null) => (a == null ? '' : `${Math.round(a).toLocaleString('de-CH')} a`)
const TILES = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg'

/** Parzellen als antippbare Flächen; zoomt auf den GPS-Standort, sonst auf
 * die gewählte Parzelle bzw. alle. */
function ParcelLayer({
  parcels,
  selectedId,
  here,
  onPick,
}: {
  parcels: PickParcel[]
  selectedId: string | null
  here: { lat: number; lng: number } | null
  onPick: (id: string) => void
}) {
  const map = useMap()
  useEffect(() => {
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: parcels
          .filter((p) => p.base_geometry)
          .map((p) => ({ type: 'Feature', properties: { id: p.id, label: `${p.name}${p.area_a != null ? ` · ${fmtA(p.area_a)}` : ''}` }, geometry: JSON.parse(p.base_geometry!) })),
      } as never,
      {
        style: (f) =>
          f?.properties.id === selectedId
            ? { color: '#1d4ed8', weight: 3, fillColor: '#3b82f6', fillOpacity: 0.45 }
            : { color: '#15803d', weight: 1.5, fillColor: '#86efac', fillOpacity: 0.25 },
        onEachFeature: (feature, l) => {
          l.bindTooltip(feature.properties.label, { sticky: true })
          l.on('click', () => onPick(feature.properties.id))
        },
      },
    )
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, parcels, selectedId, onPick])

  // Einmal ausrichten: GPS-Standort, sonst gewählte Parzelle, sonst alle
  useEffect(() => {
    if (here) {
      map.setView([here.lat, here.lng], 17)
      L.circleMarker([here.lat, here.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#1d4ed8', fillOpacity: 1 }).addTo(map)
      return
    }
    const sel = parcels.find((p) => p.id === selectedId && p.base_geometry)
    const b = L.geoJSON((sel ? [sel] : parcels.filter((p) => p.base_geometry)).map((p) => JSON.parse(p.base_geometry!)) as never).getBounds()
    if (b.isValid()) map.fitBounds(b.pad(0.1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return null
}

/** Parzelle wählen: Liste mit Suche (Name, Kultur, Betriebsstandort; mit
 * Fläche) oder Karte mit Antippen, zentriert auf den GPS-Standort. */
export default function ParcelPicker({
  parcels,
  selectedId,
  here,
  onPick,
  label = 'Parzelle wählen',
}: {
  parcels: PickParcel[]
  selectedId: string | null
  here: { lat: number; lng: number } | null
  onPick: (id: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'liste' | 'karte'>('karte')
  const [q, setQ] = useState('')
  const selected = parcels.find((p) => p.id === selectedId) ?? null
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...parcels]
      .filter((p) => !s || [p.name, p.kultur_name_de, p.farm_name].some((v) => (v ?? '').toLowerCase().includes(s)))
      .sort((a, b) => (a.farm_name ?? '').localeCompare(b.farm_name ?? '', 'de-CH') || a.name.localeCompare(b.name, 'de-CH'))
  }, [parcels, q])
  const pick = (id: string) => {
    onPick(id)
    setOpen(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-left text-sm">
        {selected ? (
          <>
            <span className="font-medium">{selected.name}</span>
            <span className="text-xs text-gray-500">
              {' '}
              · {fmtA(selected.area_a)}
              {selected.farm_name ? ` · ${selected.farm_name}` : ''}
              {selected.bff ? ' · BFF' : ''}
            </span>
          </>
        ) : (
          <span className="text-gray-500">{label} …</span>
        )}
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          <div className="mb-2 flex gap-1">
            {(['karte', 'liste'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded px-2 py-1.5 text-sm ${tab === t ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
              >
                {t === 'karte' ? '🗺 Karte' : '☰ Liste'}
              </button>
            ))}
          </div>
          {tab === 'karte' ? (
            <div>
              <div className="h-[60vh] overflow-hidden rounded">
                <MapContainer center={[46.92, 7.6]} zoom={14} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url={TILES} maxZoom={18} attribution="&copy; swisstopo" />
                  <ParcelLayer parcels={parcels} selectedId={selectedId} here={here} onPick={pick} />
                </MapContainer>
              </div>
              <p className="mt-1 text-xs text-gray-500">Parzelle antippen. {here ? 'Blauer Punkt = dein Standort.' : 'Kein GPS-Standort — Karte zeigt alle Parzellen.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                autoFocus
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Suchen: Name, Kultur, Betrieb"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <ul className="max-h-[55vh] divide-y overflow-y-auto">
                {list.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p.id)}
                      className={`flex w-full items-baseline justify-between gap-2 px-1 py-2 text-left text-sm ${p.id === selectedId ? 'bg-brand-50' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-gray-800">{p.name}</span>
                        {p.bff && <span className="ml-1 rounded bg-lime-100 px-1 text-[10px] text-lime-800">BFF</span>}
                        <span className="block truncate text-xs text-gray-500">{[p.kultur_name_de, p.farm_name].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-gray-600">{fmtA(p.area_a)}</span>
                    </button>
                  </li>
                ))}
                {list.length === 0 && <li className="py-3 text-center text-xs text-gray-500">Keine Parzelle passt.</li>}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
