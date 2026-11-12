import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// Karten ziehen mit Zeigerereignissen statt HTML5-Drag&Drop: das geht per Maus, Finger und Stift
// gleich (HTML5-Drag&Drop kennt am Tablet kein Ziehen). Maus: von der ganzen Karte aus nach 6 px
// Bewegung (ein Klick bleibt ein Klick). Finger: nur am Griff, damit Scrollen auf der Karte
// weiter geht. Ziel ist jede Fläche mit data-drop-col="<Spaltenschlüssel>".

const START_DISTANCE = 6
const EDGE = 64
const SCROLL_STEP = 14

export interface DragState {
  ids: string[]
  label: string
  x: number
  y: number
}

/** Dürfen Klicks auf dieses Element eine Ziehbewegung starten? (Knöpfe, Felder usw. nicht.) */
const interactive = (el: EventTarget | null) => el instanceof Element && !!el.closest('button, a, input, select, textarea, label, summary, [data-no-drag]')

export function useBoardDrag({
  enabled,
  idsFor,
  labelFor,
  onDrop,
  scroller,
}: {
  enabled: boolean
  /** Tiere, die mit dieser Karte gezogen werden (gewählte, sonst nur sie) */
  idsFor: (cardId: string) => string[]
  labelFor: (ids: string[]) => string
  onDrop: (ids: string[], columnKey: string) => void
  /** waagrecht scrollender Behälter für das automatische Scrollen am Rand */
  scroller: React.RefObject<HTMLElement | null>
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const session = useRef<{ pointerId: number; cardId: string; x0: number; y0: number; started: boolean; ids: string[]; x: number; y: number } | null>(null)
  const hoverRef = useRef<string | null>(null)
  const raf = useRef(0)
  const latest = useRef({ idsFor, labelFor, onDrop })
  latest.current = { idsFor, labelFor, onDrop }

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    // Einrasten der Spalten war nur während des Ziehens aus (sonst holt es jeden Scrollschritt zurück)
    if (scroller.current) scroller.current.style.scrollSnapType = ''
    session.current = null
    hoverRef.current = null
    setDrag(null)
    setHover(null)
    document.body.classList.remove('select-none', 'cursor-grabbing')
  }, [scroller])

  const tick = useCallback(() => {
    const s = session.current
    if (!s?.started) return
    const box = scroller.current?.getBoundingClientRect()
    if (box) {
      if (s.x < box.left + EDGE) scroller.current!.scrollLeft -= SCROLL_STEP
      else if (s.x > box.right - EDGE) scroller.current!.scrollLeft += SCROLL_STEP
    }
    if (s.y < EDGE) window.scrollBy(0, -SCROLL_STEP)
    else if (s.y > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP)
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
        s.ids = latest.current.idsFor(s.cardId)
        setDrag({ ids: s.ids, label: latest.current.labelFor(s.ids), x: e.clientX, y: e.clientY })
        document.body.classList.add('select-none', 'cursor-grabbing')
        if (scroller.current) scroller.current.style.scrollSnapType = 'none'
        raf.current = requestAnimationFrame(tick)
      }
      if (ghost.current) ghost.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`
      const col = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop-col]')?.dataset.dropCol ?? null
      if (col !== hoverRef.current) {
        hoverRef.current = col
        setHover(col)
      }
    }
    const up = (e: PointerEvent) => {
      const s = session.current
      if (!s || e.pointerId !== s.pointerId) return
      const col = hoverRef.current
      const ids = s.ids
      const started = s.started
      stop()
      if (started && col) latest.current.onDrop(ids, col)
    }
    const cancel = (e: PointerEvent) => {
      if (session.current && e.pointerId === session.current.pointerId) stop()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && session.current) stop()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      stop()
    }
  }, [stop, tick, scroller])

  /** Für Karte (Maus) und Griff (Maus und Finger): `handle` = Griff, dort zieht auch der Finger. */
  const pointerDown = useCallback(
    (cardId: string, handle: boolean) => (e: ReactPointerEvent) => {
      if (!enabled) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (e.pointerType !== 'mouse' && !handle) return
      if (!handle && interactive(e.target)) return
      session.current = { pointerId: e.pointerId, cardId, x0: e.clientX, y0: e.clientY, started: false, ids: [], x: e.clientX, y: e.clientY }
    },
    [enabled],
  )

  return { drag, hover, pointerDown, ghost }
}

/** Das Bild, das am Zeiger hängt. */
export function DragGhost({ drag, ghost }: { drag: DragState | null; ghost: React.RefObject<HTMLDivElement> }) {
  if (!drag) return null
  return (
    <div
      ref={ghost}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[3000] rounded-lg border-2 border-brand-700 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xl"
      style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 12}px)` }}
    >
      {drag.label}
    </div>
  )
}
