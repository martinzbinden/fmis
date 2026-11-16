import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { abonniereStandort, folgenPausieren, standort, standortKnopf, type Modus } from '../lib/standort'

const BLAU = '#2563eb'

const TITEL: Record<Modus, string> = {
  aus: 'Meinen Standort zeigen',
  suchen: 'Standort wird gesucht …',
  folgen: 'Karte folgt dem Standort – nochmals tippen für Kompass',
  gefunden: 'Zum Standort zurück',
  kompass: 'Kompass an – tippen zum Ausschalten',
}

function Symbol({ modus }: { modus: Modus }) {
  if (modus === 'kompass') {
    // Navigationspfeil
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path d="M12 2 L19 21 L12 17 L5 21 Z" fill={BLAU} />
      </svg>
    )
  }
  const aktiv = modus === 'folgen'
  const farbe = modus === 'aus' ? '#374151' : BLAU
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden className={modus === 'suchen' ? 'animate-pulse' : undefined}>
      <circle cx="12" cy="12" r="7" fill="none" stroke={farbe} strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill={aktiv ? farbe : 'none'} stroke={farbe} strokeWidth={aktiv ? 0 : 2} />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke={farbe} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Standort-Knopf und eigene Position auf einer Karte (blauer Punkt, Genauigkeitskreis, Richtungskegel im Kompass-
 * Modus). Folgt der Karte, bis jemand sie von Hand verschiebt. */
export default function Standort() {
  const map = useMap()
  const s = useSyncExternalStore(abonniereStandort, standort, standort)
  const knopf = useRef<HTMLDivElement>(null)
  const ebenen = useRef<{ punkt: L.CircleMarker; kreis: L.Circle; kegel: L.Marker } | null>(null)

  useEffect(() => {
    if (knopf.current) {
      L.DomEvent.disableClickPropagation(knopf.current)
      L.DomEvent.disableScrollPropagation(knopf.current)
    }
    const verschoben = () => folgenPausieren()
    map.on('dragstart', verschoben)
    return () => {
      map.off('dragstart', verschoben)
    }
  }, [map])

  useEffect(() => {
    const { fix, modus, richtung } = s
    if (!fix || modus === 'aus') {
      if (ebenen.current) {
        map.removeLayer(ebenen.current.punkt).removeLayer(ebenen.current.kreis).removeLayer(ebenen.current.kegel)
        ebenen.current = null
      }
      return
    }
    const ll = L.latLng(fix.lat, fix.lng)
    if (!ebenen.current) {
      ebenen.current = {
        kreis: L.circle(ll, { radius: fix.genauigkeit, color: BLAU, weight: 1, fillColor: BLAU, fillOpacity: 0.12, interactive: false }).addTo(map),
        kegel: L.marker(ll, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'standort-kegel',
            iconSize: [64, 64],
            iconAnchor: [32, 32],
            html: '<svg viewBox="0 0 64 64" width="64" height="64"><defs><radialGradient id="k" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#2563eb" stop-opacity=".55"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></radialGradient></defs><path d="M32 32 L18 4 A30 30 0 0 1 46 4 Z" fill="url(#k)"/></svg>',
          }),
        }).addTo(map),
        punkt: L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: BLAU, fillOpacity: 1, interactive: false }).addTo(map),
      }
    }
    const e = ebenen.current
    e.punkt.setLatLng(ll)
    e.kreis.setLatLng(ll).setRadius(fix.genauigkeit)
    e.kegel.setLatLng(ll)
    const r = modus === 'kompass' ? richtung : fix.kurs
    const el = e.kegel.getElement()
    if (el) {
      const svg = el.querySelector('svg')
      el.style.display = r == null ? 'none' : ''
      if (svg && r != null) svg.style.transform = `rotate(${r}deg)`
    }
    if (modus === 'folgen' || modus === 'kompass') {
      map.setView(ll, Math.max(map.getZoom(), 17), { animate: true })
    }
  }, [map, s])

  return (
    <div ref={knopf} className="leaflet-bottom leaflet-right" style={{ marginBottom: 24 }}>
      <div className="leaflet-control leaflet-bar" style={{ border: 'none' }}>
        <button
          type="button"
          onClick={() => void standortKnopf()}
          title={TITEL[s.modus]}
          aria-label={TITEL[s.modus]}
          aria-pressed={s.modus !== 'aus'}
          data-modus={s.modus}
          data-testid="standort-knopf"
          className="grid h-11 w-11 place-items-center rounded-lg bg-white shadow-md ring-1 ring-black/10 active:bg-gray-100"
        >
          <Symbol modus={s.modus} />
        </button>
        {s.modus === 'kompass' && s.richtung == null && (
          <div className="mt-1 max-w-[9rem] rounded bg-white/95 px-1.5 py-0.5 text-[11px] text-gray-600 shadow">Kein Kompass – Richtung nur in Fahrt</div>
        )}
        {s.fehler && <div className="mt-1 max-w-[12rem] rounded bg-white/95 px-1.5 py-0.5 text-[11px] text-red-700 shadow">{s.fehler}</div>}
      </div>
    </div>
  )
}
