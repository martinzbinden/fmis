import { useEffect, useRef, useState } from 'react'

export interface Fix {
  lat: number
  lng: number
  accuracy: number | null
  altitude: number | null
  timestamp: number
}

/** Standort laufend verfolgen (hohe Genauigkeit) und den Bildschirm wach halten,
 * solange `active` gilt — z.B. beim Einmessen. */
export function useGeolocation(active: boolean): { fix: Fix | null; error: string | null } {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wake = useRef<{ release: () => Promise<void> } | null>(null)

  useEffect(() => {
    if (!active) return
    if (!navigator.geolocation) {
      setError('Dieses Gerät kann den Standort nicht bestimmen.')
      return
    }
    setError(null)
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setFix({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
          altitude: p.coords.altitude != null && Number.isFinite(p.coords.altitude) ? p.coords.altitude : null,
          timestamp: p.timestamp,
        }),
      (e) => setError(e.code === 1 ? 'Standortfreigabe fehlt (Browser-Einstellung).' : 'Standort nicht verfügbar — im Freien erneut versuchen.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    )
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    void nav.wakeLock?.request('screen').then((l) => (wake.current = l)).catch(() => {})
    return () => {
      navigator.geolocation.clearWatch(id)
      void wake.current?.release().catch(() => {})
      wake.current = null
    }
  }, [active])

  return { fix, error }
}
