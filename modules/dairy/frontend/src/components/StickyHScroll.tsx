import { useEffect, useRef, useState, type RefObject } from 'react'

/** Waagrechter Scrollbalken, der am unteren Bildschirmrand stehen bleibt (Dashboard am PC): Die Spalten sind so lang
 * wie ihre Karten, der eigene Balken des Spaltenbereichs steht deshalb erst unter der längsten Spalte. Beide Balken
 * laufen gleich; passt alles in die Breite, verschwindet er. */
export default function StickyHScroll({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const bar = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, scroll: 0 })

  useEffect(() => {
    const el = target.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, scroll: el.scrollWidth })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    const mo = new MutationObserver(() => {
      for (const c of Array.from(el.children)) ro.observe(c)
      measure()
    })
    mo.observe(el, { childList: true })
    const fromTarget = () => {
      if (bar.current && Math.abs(bar.current.scrollLeft - el.scrollLeft) > 1) bar.current.scrollLeft = el.scrollLeft
    }
    el.addEventListener('scroll', fromTarget, { passive: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('scroll', fromTarget)
    }
  }, [target])

  if (size.scroll <= size.width + 1) return null
  return (
    <div
      ref={bar}
      aria-hidden
      onScroll={(e) => {
        const el = target.current
        if (el && Math.abs(el.scrollLeft - e.currentTarget.scrollLeft) > 1) el.scrollLeft = e.currentTarget.scrollLeft
      }}
      className="sticky bottom-0 z-20 hidden overflow-x-auto bg-gray-50/90 sm:block"
      style={{ width: size.width }}
    >
      <div style={{ width: size.scroll, height: 1 }} />
    </div>
  )
}
