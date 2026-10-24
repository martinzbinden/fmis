import { useRef, useState } from 'react'
import { blocksText, fromQuarters, QUARTERS, toQuarters, type Block, type DayTime } from '../lib/duty'

/** Zeitstrahl 0–24 Uhr wie bei einer Zeitschaltuhr: jede Viertelstunde per Klick ein/aus,
 * Ziehen schaltet alle überstrichenen Viertelstunden gleich (ein, wenn die erste aus war).
 * Lücken sind erlaubt (mehrere Blöcke). Rechts stehen die Zeiten, auch schon während des Ziehens.
 * `ghost` zeigt den Standard, solange nichts eigenes gesetzt ist; das erste Antippen beginnt mit ihm. */
export default function TimeStrip({
  value,
  ghost,
  color,
  muted,
  onChange,
  onReset,
  label,
}: {
  value: DayTime
  ghost: Block[]
  color: string
  muted?: boolean
  onChange: (v: Block[]) => void
  /** zurück auf die Standardzeit */
  onReset: () => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const paint = useRef<{ on: boolean; last: number } | null>(null)
  const [live, setLive] = useState<boolean[] | null>(null)
  const base = toQuarters(value ?? ghost)
  const q = live ?? base
  const isGhost = !live && !value
  const blocks = fromQuarters(q)

  const cellAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(QUARTERS - 1, Math.floor(((clientX - r.left) / r.width) * QUARTERS)))
  }
  const set = (cur: boolean[], from: number, to: number, on: boolean) => {
    const next = [...cur]
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next[i] = on
    return next
  }

  return (
    <>
      <div
        ref={ref}
        role="group"
        aria-label={`${label}: ${blocks.length ? blocksText(blocks) : 'kein Dienst'}`}
        className={`relative flex h-8 min-w-0 flex-1 cursor-pointer touch-none select-none overflow-hidden rounded bg-gray-100 ${muted ? 'opacity-40' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const c = cellAt(e.clientX)
          paint.current = { on: !base[c], last: c }
          setLive(set(base, c, c, !base[c]))
        }}
        onPointerMove={(e) => {
          const p = paint.current
          if (!p) return
          const c = cellAt(e.clientX)
          if (c === p.last) return
          // Werte jetzt festhalten: der Updater läuft erst beim nächsten Rendern, dann ist p.last schon c
          const from = p.last
          const on = p.on
          setLive((cur) => set(cur ?? base, from, c, on))
          p.last = c
        }}
        onPointerUp={() => {
          if (!paint.current || !live) return
          paint.current = null
          onChange(fromQuarters(live))
          setLive(null)
        }}
        onPointerCancel={() => {
          paint.current = null
          setLive(null)
        }}
      >
        {q.map((on, i) => (
          <span
            key={i}
            className={`h-full flex-1 ${i % 4 === 3 ? 'border-r border-white/70' : ''} ${i % 12 === 11 ? '!border-gray-400' : ''}`}
            style={on ? { background: color, opacity: isGhost ? 0.35 : 1 } : undefined}
          />
        ))}
      </div>
      <span className="flex w-28 shrink-0 items-start justify-between gap-1 text-xs tabular-nums text-gray-600">
        <span className={isGhost ? 'text-gray-400' : ''}>
          {blocks.length ? blocks.map((b) => <span key={b[0]} className="block">{blocksText([b])}</span>) : <span className="text-gray-400">kein Dienst</span>}
        </span>
        {value && (
          <button type="button" className="px-1 text-gray-500" onClick={onReset} aria-label={`${label}: Standardzeit`} title="Standardzeit">
            ×
          </button>
        )}
      </span>
    </>
  )
}

/** Achsenbeschriftung zum Zeitstrahl (0, 6, 12, 18, 24). */
export function TimeAxis() {
  return (
    <div className="relative h-4 text-[10px] text-gray-500">
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <span key={h} className={`absolute -translate-x-1/2 ${h % 6 ? 'text-gray-400' : ''}`} style={{ left: `${(h / 24) * 100}%` }}>
          {h}
        </span>
      ))}
    </div>
  )
}
