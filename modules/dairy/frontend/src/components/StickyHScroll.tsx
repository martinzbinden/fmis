import { useEffect, useRef, useState, type RefObject } from 'react'

/** Waagrechter Scrollbalken, der am unteren Bildschirmrand stehen bleibt (Dashboard am PC): Die Spalten sind so lang
 * wie ihre Karten, der eigene Balken des Spaltenbereichs steht deshalb erst unter der längsten Spalte. Beide Balken
 * laufen gleich; passt alles in die Breite, verschwindet er. */
export default function StickyHScroll({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const bar = useRef<HTMLDivElement>(null)
  // zuletzt von Hand gesetzte Werte: das Echo-Ereignis des anderen Balkens darf nicht zurückschreiben, sonst zieht es
  // beim Wischen (Trägheit) den Spaltenbereich auf einen alten Stand zurück
  const setOnBar = useRef<number | null>(null)
  const setOnTarget = useRef<number | null>(null)
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
      if (setOnTarget.current != null && Math.abs(el.scrollLeft - setOnTarget.current) <= 1) {
        setOnTarget.current = null
        return
      }
      setOnTarget.current = null
      const b = bar.current
      if (b && Math.abs(b.scrollLeft - el.scrollLeft) > 1) {
        setOnBar.current = el.scrollLeft
        b.scrollLeft = el.scrollLeft
      }
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
        const left = e.currentTarget.scrollLeft
        if (setOnBar.current != null && Math.abs(left - setOnBar.current) <= 1) {
          setOnBar.current = null
          return
        }
        setOnBar.current = null
        const el = target.current
        if (el && Math.abs(el.scrollLeft - left) > 1) {
          setOnTarget.current = left
          el.scrollLeft = left
        }
      }}
      className="sticky bottom-0 z-20 hidden overflow-x-auto bg-gray-50/90 sm:block"
      style={{ width: size.width }}
    >
      <div style={{ width: size.scroll, height: 1 }} />
    </div>
  )
}
