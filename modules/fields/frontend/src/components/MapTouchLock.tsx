// Karten mitten in der Seite: am Handy fängt die Karte sonst jedes Wischen ab und die Seite lässt sich
// nicht mehr scrollen. Auf Geräten mit Touch (pointer: coarse) ist das Ziehen und Zoomen der Karte darum
// erst nach «Karte bedienen» an, «fertig» schaltet es wieder aus. Antippen (Parzelle wählen, Popup) geht
// immer. Am Desktop und im Vollbild bleibt alles wie bisher.
import { useEffect, useState } from 'react'
import { useMap } from 'react-leaflet'

function isCoarse(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/** Zustand für eine Karte: `locked` = Ziehen/Zoomen aus (nur Touch-Geräte, nicht im Vollbild). */
export function useMapTouchLock(isFullscreen: boolean) {
  const [coarse] = useState(isCoarse)
  const [active, setActive] = useState(false)
  return { coarse, active, setActive, locked: coarse && !active && !isFullscreen }
}

/** Innerhalb von <MapContainer>: schaltet Ziehen und Fingerzoom der Karte aus bzw. wieder ein. */
export function MapTouchLock({ locked }: { locked: boolean }) {
  const map = useMap()
  useEffect(() => {
    for (const h of [map.dragging, map.touchZoom]) {
      if (!h) continue
      if (locked) h.disable()
      else h.enable()
    }
  }, [map, locked])
  return null
}

/** Knopf über der Karte: «Karte bedienen» bzw. «fertig». Nur auf Touch-Geräten und nicht im Vollbild. */
export function MapTouchButton({ lock, isFullscreen }: { lock: ReturnType<typeof useMapTouchLock>; isFullscreen: boolean }) {
  if (!lock.coarse || isFullscreen) return null
  return lock.active ? (
    <button
      type="button"
      onClick={() => lock.setActive(false)}
      className="absolute right-2 top-2 z-[1001] min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white shadow"
    >
      ✓ fertig
    </button>
  ) : (
    <button
      type="button"
      onClick={() => lock.setActive(true)}
      className="absolute bottom-3 left-1/2 z-[1001] min-h-11 -translate-x-1/2 rounded-full bg-white/95 px-4 text-sm font-semibold text-gray-800 shadow"
    >
      ✋ Karte bedienen
    </button>
  )
}
