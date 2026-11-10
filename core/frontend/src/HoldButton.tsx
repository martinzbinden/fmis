import { useEffect, useRef, useState } from 'react'

/** Auslösen nur durch Gedrückthalten (gegen versehentliches Antippen, z.B. Absetzen
 * vieler Lämmer auf einmal). Der Balken füllt sich; Loslassen vorher bricht ab. */
export default function HoldButton({ label, onDone, disabled, ms = 1200 }: { label: string; onDone: () => void; disabled?: boolean; ms?: number }) {
  const [p, setP] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setP(0)
  }
  const start = () => {
    if (disabled) return
    stop()
    const t0 = Date.now()
    timer.current = setInterval(() => {
      const f = (Date.now() - t0) / ms
      setP(Math.min(1, f))
      if (f >= 1) {
        stop()
        onDone()
      }
    }, 40)
  }
  useEffect(() => stop, [])
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      // Tastatur: Enter/Leertaste halten
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()}
      onKeyUp={stop}
      className="relative min-h-12 w-full touch-none select-none overflow-hidden rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50"
    >
      <span className="absolute inset-y-0 left-0 bg-emerald-500/80" style={{ width: `${p * 100}%` }} />
      <span className="relative">{label}</span>
    </button>
  )
}
