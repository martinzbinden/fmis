import { useEffect, useState } from 'react'

/** Aktuelle Fensterbreite, live bei Grössenänderung (z.B. Rotation) — für
 * die schmalere erste Spalte auf Smartphones (siehe JournalGridClassic.tsx). */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  useEffect(() => {
    function onResize() {
      setWidth(window.innerWidth)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

export const MOBILE_BREAKPOINT = 640
