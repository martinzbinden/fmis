import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import { colorForKultur } from '@fmis/fields/lib/kulturColor'
import 'leaflet-draw/dist/leaflet.draw.css'
import LocateControl from '@fmis/core/LocateControl'
import { getDb } from '../db/pglite'
import { loadDerivedWeide } from '../lib/journalEntry'
import { loadFieldsBackground, type FieldsBackgroundFeature } from '../lib/fieldsBackground'
import {
  ANIMAL_CATEGORY_ICON,
  ANIMAL_CATEGORY_LABEL,
  ANIMAL_CATEGORY_LETTER,
  WEED_TYPE_COLOR,
  WEED_TYPE_LABEL,
  addDaysIso,
  isoDate,
  todayIso,
} from '../lib/format'
import { fetchFertilizationMap, type FertilizationMapProps } from '../lib/report'
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

/** Zusätzliche, kräftige Hervorhebung der vom Globus-Knopf im Journal-Raster
 * angesteuerten Parzelle — der dünne, gestrichelte Umriss aus
 * BaseGeometryLayer reicht im dichten Parzellenraster allein nicht, man
 * müsste ihn erst suchen. Blinkt kurz beim Erscheinen, bleibt danach als
 * kräftiger roter Umriss stehen. */
function FocusHighlightLayer({ parcel }: { parcel: Parcel | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (!parcel?.base_geometry) return
    const layer = L.geoJSON(JSON.parse(parcel.base_geometry) as never, {
      style: { color: '#dc2626', weight: 5, fillColor: '#dc2626', fillOpacity: 0.3 },
      interactive: false,
    })
    layer.addTo(map)
    layer.bringToFront()
    let visible = true
    const blink = window.setInterval(() => {
      visible = !visible
      layer.setStyle({ opacity: visible ? 1 : 0.15, fillOpacity: visible ? 0.3 : 0.05 })
    }, 350)
    const stopBlink = window.setTimeout(() => {
      window.clearInterval(blink)
      layer.setStyle({ opacity: 1, fillOpacity: 0.3 })
    }, 1800)
    return () => {
      window.clearInterval(blink)
      window.clearTimeout(stopBlink)
      map.removeLayer(layer)
    }
  }, [map, parcel])
  return null
}

/** Tiergruppen gemäss Wiesenjournal als Symbol auf der Karte — je Parzelle
 * mit einer heutigen Weide-Nutzung ein Marker am Flächenschwerpunkt, Symbol
 * + Buchstabe nach Tierkategorie (siehe lib/format.ts). Verknüpft über
 * usage_entries.parcel_id statt paddock_version_id: Letzteres wird vom
 * Tageseditor nirgends tatsächlich gesetzt (immer null), Ersteres ist auf
 * jedem Eintrag verlässlich vorhanden. */
function AnimalGroupMarkersLayer({ parcels, today }: { parcels: Parcel[]; today: string }) {
  const map = useMap()
  const [rows, setRows] = useState<{ parcel_id: string; animal_category: string; group?: string }[]>([])

  useEffect(() => {
    let active = true
    getDb()
      .then(async (pg) => {
        const [stored, derived] = await Promise.all([
          pg.query<{ parcel_id: string; animal_category: string }>(
            `select distinct parcel_id, animal_category from usage_entries
             where usage_type = 'weide' and animal_category is not null and entry_date = $1 and deleted_at is null`,
            [today],
          ),
          // Weide aus Herdengruppen — sonst fehlten Herden, die nur über
          // Wiesenjournal → Herden geführt werden
          loadDerivedWeide(pg, today, today),
        ])
        const out: { parcel_id: string; animal_category: string; group?: string }[] = [...stored.rows]
        for (const d of derived) {
          if (!d.animal_category || out.some((r) => r.parcel_id === d.parcel_id && r.animal_category === d.animal_category)) continue
          out.push({ parcel_id: d.parcel_id, animal_category: d.animal_category, group: d.animal_group ?? undefined })
        }
        return out
      })
      .then((rows) => {
        if (active) setRows(rows)
      })
    return () => {
      active = false
    }
  }, [today])

  useEffect(() => {
    const byParcel = new Map(parcels.map((p) => [p.id, p]))
    // Zwei Gruppen auf derselben Parzelle am selben Tag (selten, z.B.
    // Mischweide) sonst exakt deckungsgleich — minimaler Versatz pro
    // weiterem Marker, damit beide antippbar bleiben.
    const seenAtParcel = new Map<string, number>()
    const group = L.layerGroup()
    for (const r of rows) {
      const parcel = byParcel.get(r.parcel_id)
      if (!parcel?.base_geometry) continue
      const center = L.geoJSON(JSON.parse(parcel.base_geometry) as never).getBounds().getCenter()
      const n = seenAtParcel.get(r.parcel_id) ?? 0
      seenAtParcel.set(r.parcel_id, n + 1)
      const lat = center.lat + n * 0.00012
      const icon = L.divIcon({
        className: '',
        html:
          `<div style="position:relative;font-size:20px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))">` +
          `${ANIMAL_CATEGORY_ICON[r.animal_category] ?? '🐾'}` +
          `<span style="position:absolute;bottom:-3px;right:-5px;background:#fff;border:1px solid #334155;border-radius:50%;` +
          `width:13px;height:13px;font-size:8px;line-height:12px;text-align:center;font-weight:700;color:#334155">` +
          `${ANIMAL_CATEGORY_LETTER[r.animal_category] ?? ''}</span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      L.marker([lat, center.lng], { icon })
        .bindTooltip(`${ANIMAL_CATEGORY_LABEL[r.animal_category] ?? r.animal_category}${r.group ? ` (Herde «${r.group}»)` : ''} · ${parcel.name}`)
        .addTo(group)
    }
    group.addTo(map)
    return () => {
      map.removeLayer(group)
    }
  }, [map, rows, parcels])

  return null
}

// Farbrampe Weidetage (Schafe) für die Parasitendruck-Karte.
const SHEEP_RAMP: [number, string][] = [
  [1, '#fef9c3'],
  [3, '#fde047'],
  [7, '#fb923c'],
  [14, '#f97316'],
  [30, '#dc2626'],
  [60, '#7f1d1d'],
]
function sheepColor(days: number): string {
  let c = SHEEP_RAMP[0][1]
  for (const [t, col] of SHEEP_RAMP) if (days >= t) c = col
  return c
}

/** Parasitendruck-Karte für Schafweiden: Weidetage mit Schafen je Parzelle
 * im gewählten Zeitraum, als Farbrampe — rein client-seitig aus
 * usage_entries gezählt (anders als die Düngungskarte kein geometrischer
 * Verschnitt nötig, eine Parzelle ist bereits die richtige Einheit). */
function SheepPressureLayer({
  parcels,
  from,
  to,
  onInfo,
}: {
  parcels: Parcel[]
  from: string
  to: string
  onInfo: (msg: string | null) => void
}) {
  const map = useMap()
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let active = true
    onInfo(null)
    getDb()
      .then(async (pg) => {
        const [stored, derived] = await Promise.all([
          pg.query<{ parcel_id: string; entry_date: unknown }>(
            `select distinct parcel_id, entry_date from usage_entries
             where usage_type = 'weide' and animal_category = 'schafe' and deleted_at is null
               and entry_date between $1 and $2`,
            [from, to],
          ),
          loadDerivedWeide(pg, from, to),
        ])
        // Tage je Parzelle: gespeicherte Einträge und Weide aus Herden zusammen,
        // ein Tag zählt einmal
        const days = new Map<string, Set<string>>()
        const add = (parcel: string, date: string) => days.set(parcel, (days.get(parcel) ?? new Set()).add(date))
        for (const r of stored.rows) add(r.parcel_id, isoDate(r.entry_date))
        for (const d of derived) if (d.animal_category === 'schafe') add(d.parcel_id, d.entry_date)
        return days
      })
      .then((days) => {
        if (!active) return
        const next: Record<string, number> = {}
        for (const [parcel, set] of days) next[parcel] = set.size
        setCounts(next)
        if (days.size === 0) onInfo('Keine Schafweide-Einträge im gewählten Zeitraum.')
      })
    return () => {
      active = false
    }
  }, [from, to, onInfo])

  useEffect(() => {
    const features = parcels
      .filter((p) => p.base_geometry && counts[p.id] > 0)
      .map((p) => ({
        type: 'Feature' as const,
        properties: { name: p.name, days: counts[p.id] },
        geometry: JSON.parse(p.base_geometry!),
      }))
    if (features.length === 0) return
    const layer = L.geoJSON({ type: 'FeatureCollection', features } as never, {
      style: (f) => ({ color: '#7f1d1d', weight: 0.5, fillColor: sheepColor((f?.properties as { days: number }).days), fillOpacity: 0.6 }),
      onEachFeature: (f, l) => {
        const p = f.properties as { name: string; days: number }
        l.bindTooltip(`${p.name} · ${p.days} Weidetag${p.days === 1 ? '' : 'e'} (Schafe)`, { sticky: true })
      },
    })
    layer.addTo(map)
    const Legend = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'rounded bg-white/90 p-2 text-[10px] leading-tight shadow')
        div.innerHTML =
          '<div class="mb-1 font-semibold">Weidetage (Schafe)</div>' +
          SHEEP_RAMP.map(([t, c], i) => {
            const next = SHEEP_RAMP[i + 1]?.[0]
            return `<div class="flex items-center gap-1"><span style="background:${c};width:14px;height:10px;display:inline-block;border:1px solid #7f1d1d"></span>${next ? `${t}–${next - 1}` : `≥ ${t}`}</div>`
          }).join('')
        return div
      },
    })
    const legend = new Legend({ position: 'bottomleft' })
    legend.addTo(map)
    return () => {
      map.removeLayer(layer)
      map.removeControl(legend)
    }
  }, [map, parcels, counts])

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

export interface FertilizationFeature {
  id: string
  label: string
  geometry: string
}

/** Düngungsmassnahmen der Saison (Polygon/Track-Puffer bzw. gedüngte Parzellen) — amber, rein informativ. */
function FertilizationLayer({ features }: { features: FertilizationFeature[] }) {
  const map = useMap()
  useEffect(() => {
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: features.map((f) => ({ type: 'Feature', properties: { label: f.label }, geometry: JSON.parse(f.geometry) })),
      } as never,
      {
        style: { color: '#b45309', weight: 1.5, fillColor: '#f59e0b', fillOpacity: 0.25 },
        interactive: true,
        onEachFeature: (feature, l) => l.bindTooltip(feature.properties.label, { sticky: true }),
      },
    )
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, features])
  return null
}

// Farbrampe kg N/ha für die Düngungskarte (Verschnitt) — 6 Stufen.
const N_RAMP: [number, string][] = [
  [0, '#fef3c7'],
  [30, '#fde68a'],
  [60, '#fbbf24'],
  [90, '#f59e0b'],
  [120, '#d97706'],
  [150, '#92400e'],
]
function nColor(v: number): string {
  let c = N_RAMP[0][1]
  for (const [t, col] of N_RAMP) if (v >= t) c = col
  return c
}

/** Düngungskarte: Verschnitt aller Massnahmen des Jahres (Server, PostGIS) — Fläche × Summe kg N/ha. */
function FertilizationHeatLayer({ seasonYear, onError }: { seasonYear: number; onError: (msg: string | null) => void }) {
  const map = useMap()
  useEffect(() => {
    let layer: L.GeoJSON | null = null
    let legend: L.Control | null = null
    let cancelled = false
    onError(null)
    fetchFertilizationMap(seasonYear)
      .then((fc) => {
        if (cancelled) return
        layer = L.geoJSON(fc as never, {
          style: (f) => ({
            color: '#78350f',
            weight: 0.5,
            fillColor: nColor((f?.properties as FertilizationMapProps).n_kg_per_ha),
            fillOpacity: 0.6,
          }),
          onEachFeature: (f, l) => {
            const p = f.properties as FertilizationMapProps
            l.bindTooltip(`${p.n_kg_per_ha} kg N/ha (${p.n_avail_kg_per_ha} verfügbar) · ${p.count} Massnahme${p.count === 1 ? '' : 'n'} · ${p.area_a} a`, {
              sticky: true,
            })
          },
        })
        layer.addTo(map)
        const Legend = L.Control.extend({
          onAdd: () => {
            const div = L.DomUtil.create('div', 'rounded bg-white/90 p-2 text-[10px] leading-tight shadow')
            div.innerHTML =
              '<div class="mb-1 font-semibold">kg N/ha</div>' +
              N_RAMP.map(([t, c], i) => {
                const next = N_RAMP[i + 1]?.[0]
                return `<div class="flex items-center gap-1"><span style="background:${c};width:14px;height:10px;display:inline-block;border:1px solid #78350f"></span>${next ? `${t}–${next}` : `≥ ${t}`}</div>`
              }).join('')
            return div
          },
        })
        legend = new Legend({ position: 'bottomleft' })
        legend.addTo(map)
        if (fc.features.length === 0) onError('Keine Massnahmen mit Fläche und Nährstoffen in diesem Jahr.')
      })
      .catch((err) => {
        if (!cancelled) onError(err instanceof Error ? err.message : 'Düngungskarte nicht verfügbar (offline?)')
      })
    return () => {
      cancelled = true
      if (layer) map.removeLayer(layer)
      if (legend) map.removeControl(legend)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, seasonYear])
  return null
}

export default function PaddockMap({
  paddocks,
  parcels,
  fertilization = [],
  seasonYear,
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
  focusParcelId,
}: {
  paddocks: Paddock[]
  parcels: Parcel[]
  /** Düngungsmassnahmen für den Layer „Düngung" (optional). */
  fertilization?: FertilizationFeature[]
  /** Saison für die Düngungskarte (Verschnitt, server-berechnet). */
  seasonYear: number
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
  onLocationFound?: (lat: number, lng: number, accuracyM: number) => void
  onWeedSelect: (observation: WeedObservation) => void
  onPickLocation?: (lat: number, lng: number) => void
  focusParcelId?: string | null
}) {
  const [background, setBackground] = useState<BackgroundKey>('pixelkarte')
  const [showTemplate, setShowTemplate] = useState(false)
  const [showFertilization, setShowFertilization] = useState(false)
  const [showHeat, setShowHeat] = useState(false)
  const [heatError, setHeatError] = useState<string | null>(null)
  // Tiergruppen (heutige Weide-Nutzung) — standardmässig an, im Gegensatz zu
  // den übrigen Overlays die Hauptsache, wenn man auf die Karte schaut.
  const [showAnimals, setShowAnimals] = useState(true)
  const [showSheep, setShowSheep] = useState(false)
  const [sheepWindow, setSheepWindow] = useState<'2months' | 'year'>('2months')
  const [sheepInfo, setSheepInfo] = useState<string | null>(null)
  const today = todayIso()
  const sheepFrom = sheepWindow === '2months' ? addDaysIso(today, -60) : `${seasonYear}-01-01`
  const sheepTo = sheepWindow === '2months' ? today : `${seasonYear}-12-31`
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

  const focusParcel = useMemo(
    () => parcels.find((p) => p.id === focusParcelId),
    [parcels, focusParcelId],
  )

  // Vom Globus-Knopf im Journal-Raster (?parcel=…) — näher heranzoomen als
  // die allgemeine Gesamtansicht oben, läuft deshalb danach (überschreibt sie).
  useEffect(() => {
    if (!focusParcel?.base_geometry) return
    const b = L.geoJSON(JSON.parse(focusParcel.base_geometry) as never).getBounds()
    if (b.isValid()) mapRef.current?.fitBounds(b, { padding: [40, 40], maxZoom: 18 })
  }, [focusParcel])

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
        {fertilization.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFertilization((v) => !v)}
            title="Gedüngte Flächen dieser Saison einblenden"
            className={`rounded px-2 py-1 font-medium ${showFertilization ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            Düngung ({fertilization.length})
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowHeat((v) => !v)}
          title="Düngungskarte: Verschnitt aller Massnahmen des Jahres, Summe kg N/ha je Teilfläche — unabhängig von Parzellengrenzen (Internet nötig)"
          className={`rounded px-2 py-1 font-medium ${showHeat ? 'bg-amber-800 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          Düngungskarte
        </button>
        <button
          type="button"
          onClick={() => setShowAnimals((v) => !v)}
          title="Tiergruppen gemäss Wiesenjournal (heutige Weide-Nutzung) als Symbol anzeigen"
          className={`rounded px-2 py-1 font-medium ${showAnimals ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          🐄 Tiergruppen
        </button>
        <button
          type="button"
          onClick={() => setShowSheep((v) => !v)}
          title="Parasitendruck: Weidetage mit Schafen je Parzelle im gewählten Zeitraum"
          className={`rounded px-2 py-1 font-medium ${showSheep ? 'bg-red-800 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          🐑 Parasitendruck
        </button>
        {showSheep && (
          <div className="flex overflow-hidden rounded border border-red-800">
            <button
              type="button"
              onClick={() => setSheepWindow('2months')}
              className={`px-2 py-1 font-medium ${sheepWindow === '2months' ? 'bg-red-800 text-white' : 'bg-white text-red-800'}`}
            >
              2 Mte.
            </button>
            <button
              type="button"
              onClick={() => setSheepWindow('year')}
              className={`px-2 py-1 font-medium ${sheepWindow === 'year' ? 'bg-red-800 text-white' : 'bg-white text-red-800'}`}
            >
              Jahr
            </button>
          </div>
        )}
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
        {focusParcelId && <FocusHighlightLayer parcel={focusParcel} />}
        {showFertilization && <FertilizationLayer features={fertilization} />}
        {showHeat && <FertilizationHeatLayer seasonYear={seasonYear} onError={setHeatError} />}
        {showAnimals && <AnimalGroupMarkersLayer parcels={parcels} today={today} />}
        {showSheep && <SheepPressureLayer parcels={parcels} from={sheepFrom} to={sheepTo} onInfo={setSheepInfo} />}
        {showTemplate && <FieldsTemplateLayer onAdopt={onAdoptFieldsGeometry} />}
        <DrawLayer paddocks={paddocks} onCreated={onCreated} onEdited={onEdited} onDeleted={onDeleted} onSelect={onSelect} />
        <TracksLayer tracks={tracks} livePoints={livePoints} />
        <WeedMarkersLayer observations={weedObservations} onSelect={onWeedSelect} />
        <LocateControl onLocationFound={onLocationFound} />
        {onPickLocation && <MapClickCatcher active={pickingLocation} onPick={onPickLocation} />}
      </MapContainer>
      {showHeat && heatError && (
        <div className="border-t bg-amber-50 p-2 text-center text-xs text-amber-800">{heatError}</div>
      )}
      {showSheep && sheepInfo && (
        <div className="border-t bg-red-50 p-2 text-center text-xs text-red-800">{sheepInfo}</div>
      )}
      {pickingLocation && (
        <div className="border-t bg-amber-50 p-2 text-center text-xs font-medium text-amber-800">
          Tippe auf die Karte, um den Standort zu wählen…
        </div>
      )}
    </div>
  )
}
