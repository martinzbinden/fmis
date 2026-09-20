import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

/**
 * "Mein Standort" — Leaflets eingebaute Geolocation (map.locate), kein
 * zusätzliches Plugin nötig. Zeigt einen blauen Punkt an der gefundenen
 * Position und meldet sie optional nach aussen (z.B. Wiesenjournal-
 * Unkraut-Knopf: "aktuellen Fix verwenden").
 *
 * Gemeinsam für alle Karten in FMIS (Wiesenjournal PaddockMap, Kulturen
 * FieldMap/PlanningMap): als Kind von <MapContainer> rendern; der
 * zugehörige Toolbar-Knopf ruft `mapRef.current?.locate({ setView: true,
 * maxZoom: 18, enableHighAccuracy: true })` auf.
 */
export default function LocateControl({
  onLocationFound,
}: {
  onLocationFound?: (lat: number, lng: number) => void
}) {
  const map = useMap()
  const markerRef = useRef<L.CircleMarker | null>(null)
  const callbackRef = useRef(onLocationFound)
  callbackRef.current = onLocationFound
  useEffect(() => {
    function handleFound(e: L.LocationEvent) {
      if (!markerRef.current) {
        markerRef.current = L.circleMarker(e.latlng, {
          radius: 8,
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(map)
      } else {
        markerRef.current.setLatLng(e.latlng)
      }
      callbackRef.current?.(e.latlng.lat, e.latlng.lng)
    }
    map.on('locationfound', handleFound)
    return () => {
      map.off('locationfound', handleFound)
      if (markerRef.current) map.removeLayer(markerRef.current)
      markerRef.current = null
    }
  }, [map])
  return null
}
