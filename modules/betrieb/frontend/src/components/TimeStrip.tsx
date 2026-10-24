import { useRef, useState } from 'react'
import { hhmm, type DayTime } from '../lib/duty'

const STEP = 15
const CELLS = (24 * 60) / STEP

/** Zeitstrahl 0–24 Uhr in 15-Minuten-Schritten (wie die Zeitpläne der Fritzbox):
 * mit dem Finger oder der Maus über die gewünschte Zeit ziehen. Ein Tipp setzt 15 Minuten.
 * `ghost` zeigt den Standard, solange nichts eigenes gesetzt ist. */
export default function TimeStrip({
  value,
  ghost,
  color,
  muted,
  onChange,
  label,
}: {
  value: DayTime
  ghost: DayTime
  color: string
  muted?: boolean
  onChange: (v: DayTime) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)
  const [drag, setDrag] = useState<[number, number] | null>(null)

  const cellAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(CELLS - 1, Math.floor(((clientX - r.left) / r.width) * CELLS)))
  }
  const range = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]
  const shown: DayTime = drag ? [drag[0] * STEP, (drag[1] - drag[0] + 1) * STEP] : (value ?? ghost)
  const isGhost = !drag && !value
  const pct = (min: number) => `${(min / (24 * 60)) * 100}%`

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuetext={shown ? `${hhmm(shown[0])} bis ${hhmm(Math.min(24 * 60, shown[0] + shown[1]))}` : 'kein Eintrag'}
      tabIndex={0}
      className={`relative h-8 min-w-0 flex-1 touch-none select-none rounded bg-gray-100 ${muted ? 'opacity-40' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const c = cellAt(e.clientX)
        anchor.current = c
        setDrag([c, c])
      }}
      onPointerMove={(e) => {
        if (anchor.current == null) return
        setDrag(range(anchor.current, cellAt(e.clientX)))
      }}
      onPointerUp={(e) => {
        if (anchor.current == null) return
        const [a, b] = range(anchor.current, cellAt(e.clientX))
        anchor.current = null
        setDrag(null)
        onChange([a * STEP, (b - a + 1) * STEP])
      }}
      onPointerCancel={() => {
        anchor.current = null
        setDrag(null)
      }}
    >
      {/* Stundenraster: alle 3 Stunden eine Linie, alle 6 stärker */}
      {Array.from({ length: 7 }, (_, i) => i * 3).map((h) => (
        <span key={h} className={`absolute top-0 h-full ${h % 6 === 0 ? 'w-px bg-gray-400' : 'w-px bg-gray-300'}`} style={{ left: pct(h * 60) }} />
      ))}
      {shown && (
        <span
          className="absolute top-1 h-6 rounded"
          style={{
            left: pct(shown[0]),
            width: pct(Math.min(shown[1], 24 * 60 - shown[0])),
            background: color,
            opacity: isGhost ? 0.35 : 1,
            outline: isGhost ? `1px dashed ${color}` : undefined,
          }}
        />
      )}
    </div>
  )
}

/** Achsenbeschriftung zum Zeitstrahl (0, 6, 12, 18, 24). */
export function TimeAxis() {
  return (
    <div className="relative h-4 text-[10px] text-gray-500">
      {[0, 6, 12, 18, 24].map((h) => (
        <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
          {h}
        </span>
      ))}
    </div>
  )
}
