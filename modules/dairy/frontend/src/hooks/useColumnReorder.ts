import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

const START_DISTANCE = 6
const EDGE = 64
const SCROLL_STEP = 14

export interface ColumnDrag {
  key: string
  label: string
}

/** Spalten des Dashboards per Zeiger umordnen (Maus, Finger, Stift): am Griff ⠿ der Spaltenkopf ziehen und vor oder
 * nach einer anderen Spalte (data-col-key) loslassen. Eingeklappte, gestapelte Spalten (data-stacked="1") ordnen nach oben/unten,
 * die anderen nach links/rechts. */
export function useColumnReorder({ onMove, scroller }: { onMove: (from: string, to: string, after: boolean) => void; scroller: RefObject<HTMLElement | null> }) {
  const [drag, setDrag] = useState<ColumnDrag | null>(null)
  const [target, setTarget] = useState<{ key: string; after: boolean } | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const session = useRef<{ pointerId: number; key: string; label: string; x0: number; y0: number; x: number; y: number; started: boolean } | null>(null)
  const targetRef = useRef<{ key: string; after: boolean } | null>(null)
  const raf = useRef(0)
  const latest = useRef(onMove)
  latest.current = onMove

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    session.current = null
    targetRef.current = null
    setDrag(null)
    setTarget(null)
    document.body.classList.remove('select-none', 'cursor-grabbing')
  }, [])

  const tick = useCallback(() => {
    const s = session.current
    if (!s?.started) return
    const box = scroller.current?.getBoundingClientRect()
    if (box && scroller.current) {
      if (s.x < box.left + EDGE) scroller.current.scrollLeft -= SCROLL_STEP
      else if (s.x > box.right - EDGE) scroller.current.scrollLeft += SCROLL_STEP
    }
    raf.current = requestAnimationFrame(tick)
  }, [scroller])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = session.current
      if (!s || e.pointerId !== s.pointerId) return
      s.x = e.clientX
      s.y = e.clientY
      if (!s.started) {
        if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < START_DISTANCE) return
        s.started = true
        setDrag({ key: s.key, label: s.label })
        document.body.classList.add('select-none', 'cursor-grabbing')
        raf.current = requestAnimationFrame(tick)
      }
      if (ghost.current) ghost.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-col-key]')
      let next: { key: string; after: boolean } | null = null
      if (el && el.dataset.colKey && el.dataset.colKey !== s.key) {
        const r = el.getBoundingClientRect()
        const stacked = el.dataset.stacked === '1'
        next = { key: el.dataset.colKey, after: stacked ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2 }
      }
      const prev = targetRef.current
      if (prev?.key !== next?.key || prev?.after !== next?.after) {
        targetRef.current = next
        setTarget(next)
      }
    }
    const up = (e: PointerEvent) => {
      const s = session.current
      if (!s || e.pointerId !== s.pointerId) return
      const t = targetRef.current
      const started = s.started
      const from = s.key
      stop()
      if (started && t) latest.current(from, t.key, t.after)
    }
    const cancel = (e: PointerEvent) => {
      if (session.current && e.pointerId === session.current.pointerId) stop()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && session.current) stop()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', esc)
      stop()
    }
  }, [stop, tick])

  /** Für den Griff im Spaltenkopf. */
  const handleDown = useCallback(
    (key: string, label: string) => (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.stopPropagation()
      session.current = { pointerId: e.pointerId, key, label, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false }
    },
    [],
  )

  return { drag, target, handleDown, ghost }
}
