// Eigener Standort für alle Karten: GPS-Position und (wo vorhanden) Kompassrichtung des Geräts. Ein gemeinsamer Zustand,
// damit z.B. «Unkraut an meinem Standort» die zuletzt gefundene Position verwenden kann.

import { geoErrorText } from './photo'

export interface Fix {
  lat: number
  lng: number
  genauigkeit: number
  zeit: number
  /** Fahrtrichtung aus dem GPS (nur in Bewegung) */
  kurs: number | null
}

export type Modus = 'aus' | 'suchen' | 'folgen' | 'gefunden' | 'kompass'

interface Zustand {
  modus: Modus
  fix: Fix | null
  richtung: number | null // Grad, 0 = Nord, im Uhrzeigersinn
  fehler: string | null
}

let z: Zustand = { modus: 'aus', fix: null, richtung: null, fehler: null }
const listeners = new Set<() => void>()
let watchId: number | null = null
let orientierung: ((e: DeviceOrientationEvent) => void) | null = null

function setzen(p: Partial<Zustand>) {
  z = { ...z, ...p }
  listeners.forEach((l) => l())
}
export function standort(): Zustand {
  return z
}
export function abonniereStandort(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function gpsStarten() {
  if (watchId != null) return
  if (!navigator.geolocation) {
    setzen({ modus: 'aus', fehler: 'Dieses Gerät kann keinen Standort liefern.' })
    return
  }
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const kurs = p.coords.heading != null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 1 ? p.coords.heading : null
      setzen({
        fix: { lat: p.coords.latitude, lng: p.coords.longitude, genauigkeit: Math.round(p.coords.accuracy), zeit: p.timestamp || Date.now(), kurs },
        fehler: null,
        modus: z.modus === 'suchen' ? 'folgen' : z.modus,
      })
    },
    (e) => {
      setzen({ fehler: geoErrorText(e) })
      if (e.code === e.PERMISSION_DENIED) aus()
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
  )
}

function bildschirmWinkel(): number {
  return (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number
}

async function kompassStarten(): Promise<void> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  if (typeof D?.requestPermission === 'function') {
    // iOS: nur nach einem Tippen erlaubt
    if ((await D.requestPermission()) !== 'granted') throw new Error('Kompass nicht erlaubt.')
  }
  orientierung = (e: DeviceOrientationEvent) => {
    const ios = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading
    const h = ios ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null)
    if (h == null) return
    setzen({ richtung: (h + bildschirmWinkel() + 360) % 360 })
  }
  window.addEventListener('deviceorientationabsolute', orientierung as EventListener)
  window.addEventListener('deviceorientation', orientierung as EventListener)
}

function kompassStoppen() {
  if (!orientierung) return
  window.removeEventListener('deviceorientationabsolute', orientierung as EventListener)
  window.removeEventListener('deviceorientation', orientierung as EventListener)
  orientierung = null
}

function aus() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  kompassStoppen()
  setzen({ modus: 'aus', richtung: null })
}

/** Tippen auf den Knopf: aus → Standort suchen und folgen → Kompass → aus (wie map.geo.admin.ch). Hat jemand die
 * Karte verschoben («gefunden»), holt das nächste Tippen den Standort zurück in die Mitte. */
export async function standortKnopf(): Promise<void> {
  if (z.modus === 'aus') {
    setzen({ modus: z.fix && Date.now() - z.fix.zeit < 15000 ? 'folgen' : 'suchen', fehler: null })
    gpsStarten()
  } else if (z.modus === 'gefunden' || z.modus === 'suchen') {
    setzen({ modus: 'folgen' })
  } else if (z.modus === 'folgen') {
    try {
      await kompassStarten()
      setzen({ modus: 'kompass' })
    } catch (e) {
      setzen({ fehler: e instanceof Error ? e.message : String(e) })
      aus()
    }
  } else {
    aus()
  }
}

/** Die Karte wurde von Hand verschoben: Punkt bleibt, Folgen pausiert. */
export function folgenPausieren(): void {
  if (z.modus === 'folgen' || z.modus === 'kompass') {
    kompassStoppen()
    setzen({ modus: 'gefunden', richtung: null })
  }
}

/** Aktuelle Position für eine Erfassung: frische bekannte Position, sonst einmal abfragen. */
export async function aktuellePosition(maxAlterMs = 20000): Promise<Fix> {
  if (z.fix && Date.now() - z.fix.zeit < maxAlterMs) return z.fix
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Dieses Gerät kann keinen Standort liefern.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const fix = { lat: p.coords.latitude, lng: p.coords.longitude, genauigkeit: Math.round(p.coords.accuracy), zeit: Date.now(), kurs: null }
        setzen({ fix })
        resolve(fix)
      },
      (e) => reject(new Error(geoErrorText(e))),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    )
  })
}
