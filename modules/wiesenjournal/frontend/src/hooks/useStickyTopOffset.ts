import { useEffect, useState } from 'react'

/** Höhe der klebenden App-Kopfzeile (core/frontend Layout.tsx, <header
 * className="sticky top-0 …">) — misst live statt eine Pixelzahl zu raten,
 * damit die Raster-eigene Datums-Kopfzeile (sticky darunter) nicht verdeckt
 * wird, auch wenn sich die App-Kopfzeile mal ändert. */
export function useStickyTopOffset(): number {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const update = () => setOffset(header.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])
  return offset
}
