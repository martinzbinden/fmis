import { useMemo, useRef, useState } from 'react'
import { Marker, Polygon, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { LngLat } from '@fmis/core/lv95'
import type { Geom } from '../lib/geometry'
import { insertAt, insertIndex, removeAt } from '../lib/draftEdit'

const ll = (c: LngLat): [number, number] => [c[1], c[0]]

// Symbole einmal anlegen und wiederverwenden: ein neues Symbol ersetzt das Element des Markers,
// und ein laufendes Ziehen bricht ohne «dragend» ab (die Karte zeichnet bei jeder Mausbewegung neu).
const iconCache = new Map<string, L.DivIcon>()
const cached = (key: string, make: () => L.DivIcon) => iconCache.get(key) ?? iconCache.set(key, make()).get(key)!

const vertexIcon = (n: number, touch: boolean) =>
  cached(`v${n}-${touch}`, () => L.divIcon({
    className: '',
    iconSize: [touch ? 30 : 20, touch ? 30 : 20],
    iconAnchor: [touch ? 15 : 10, touch ? 15 : 10],
    html: `<div style="width:100%;height:100%;border-radius:50%;background:#fff;border:3px solid #0e7490;display:flex;align-items:center;justify-content:center;font:700 10px sans-serif;color:#0e7490">${n}</div>`,
  }))

const midIcon = (touch: boolean) =>
  cached(`m-${touch}`, () => L.divIcon({
    className: '',
    iconSize: [touch ? 22 : 14, touch ? 22 : 14],
    iconAnchor: [touch ? 11 : 7, touch ? 11 : 7],
    html: '<div style="width:100%;height:100%;border-radius:50%;background:rgba(14,116,144,.35);border:2px solid #0e7490"></div>',
  }))

/** Entwurf beim Zeichnen und Bearbeiten. Bearbeiten wie in map.geo.admin.ch:
 * Punkt ziehen = verschieben, Punkt anklicken = löschen, auf der Linie ziehen = neuer Punkt.
 * Auf dem Handy dienen die kleinen Kreise in der Mitte jedes Stücks als Griff (ziehen oder antippen). */
export default function DraftLayer({ draft, draftType, editing, touch, onChange }: { draft: LngLat[]; draftType: Geom['type']; editing: boolean; touch: boolean; onChange: (coords: LngLat[]) => void }) {
  const map = useMap()
  // neuer Punkt, der gerade von der Linie weggezogen wird
  const [ghost, setGhost] = useState<{ index: number; pos: LngLat } | null>(null)
  // Nach dem Ziehen folgt ein Klick: der darf den Punkt nicht löschen
  const lastDrag = useRef(0)
  const shown = ghost ? insertAt(draft, ghost.index, ghost.pos) : draft
  // Gleiche Positionen = gleiche Objekte: sonst setzt jedes Neuzeichnen (z.B. die Koordinatenanzeige
  // bei jeder Mausbewegung) den gezogenen Punkt auf den alten Ort zurück.
  const positions = useMemo(() => shown.map(ll), [shown])
  const closed = draftType === 'Polygon'
  const mids = useMemo(
    () =>
      draftType === 'Point'
        ? []
        : draft.slice(0, closed ? draft.length : draft.length - 1).map((c, i) => {
            const n = draft[(i + 1) % draft.length]
            return ll([(c[0] + n[0]) / 2, (c[1] + n[1]) / 2])
          }),
    [draft, draftType, closed],
  )

  function startInsert(e: L.LeafletMouseEvent) {
    if (!editing || draftType === 'Point' || touch) return
    // vor dem Verschieben der Karte (die hört auf denselben Mausdruck)
    map.dragging.disable()
    L.DomEvent.stop(e.originalEvent)
    const index = insertIndex(draft.map((c) => map.latLngToLayerPoint(ll(c))), map.latLngToLayerPoint(e.latlng), closed)
    const at = (ev: MouseEvent): LngLat => {
      const p = map.mouseEventToLatLng(ev)
      return [p.lng, p.lat]
    }
    let moved = false
    setGhost({ index, pos: [e.latlng.lng, e.latlng.lat] })
    const move = (ev: MouseEvent) => {
      moved = true
      setGhost({ index, pos: at(ev) })
    }
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      map.dragging.enable()
      setGhost(null)
      lastDrag.current = Date.now()
      if (moved) onChange(insertAt(draft, index, at(ev)))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function remove(i: number) {
    if (Date.now() - lastDrag.current < 400) return
    const next = removeAt(draft, i, draftType)
    if (next) onChange(next)
  }

  if (draft.length === 0) return null
  const lineStyle = { color: '#0e7490', weight: editing ? 6 : 4, dashArray: '6 6', className: editing && !touch ? '!cursor-copy' : undefined }
  return (
    <>
      {draftType !== 'Point' &&
        shown.length > 1 &&
        (closed ? (
          <Polygon key={`p${editing}`} positions={positions} pathOptions={{ ...lineStyle, weight: 3, fillOpacity: 0.15 }} interactive={editing && !touch} eventHandlers={{ mousedown: startInsert }} />
        ) : (
          <Polyline key={`l${editing}`} positions={positions} pathOptions={lineStyle} interactive={editing && !touch} eventHandlers={{ mousedown: startInsert }} />
        ))}
      {positions.map((p, i) => (
        <Marker
          key={`v${i}-${editing}`}
          position={p}
          icon={vertexIcon(i + 1, touch)}
          draggable={editing && !ghost}
          title={editing ? (draftType === 'Point' ? 'Ziehen = verschieben' : `Punkt ${i + 1}: ziehen = verschieben, ${touch ? 'antippen' : 'anklicken'} = löschen`) : undefined}
          eventHandlers={
            editing
              ? {
                  dragstart: () => (lastDrag.current = Date.now()),
                  dragend: (e) => {
                    lastDrag.current = Date.now()
                    const q = (e.target as L.Marker).getLatLng()
                    onChange(draft.map((x, k) => (k === i ? ([q.lng, q.lat] as LngLat) : x)))
                  },
                  click: (e) => {
                    L.DomEvent.stop(e)
                    remove(i)
                  },
                }
              : undefined
          }
        />
      ))}
      {editing &&
        !ghost &&
        mids.map((p, i) => (
          <Marker
            key={`m${i}`}
            position={p}
            icon={midIcon(touch)}
            draggable
            title="Ziehen oder anklicken = neuer Punkt"
            eventHandlers={{
              dragstart: () => (lastDrag.current = Date.now()),
              dragend: (e) => {
                lastDrag.current = Date.now()
                const q = (e.target as L.Marker).getLatLng()
                onChange(insertAt(draft, i + 1, [q.lng, q.lat]))
              },
              click: (e) => {
                L.DomEvent.stop(e)
                if (Date.now() - lastDrag.current < 400) return
                onChange(insertAt(draft, i + 1, [p[1], p[0]]))
              },
            }}
          />
        ))}
    </>
  )
}
