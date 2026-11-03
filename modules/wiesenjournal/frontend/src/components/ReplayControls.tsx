import { useEffect, useRef, useState } from 'react'
import { replayState, type ReplaySegment } from '../lib/replay'

/** Wiedergabe-Leiste unter der Karte: Start/Pause, Zeitleiste, Tempo, Legende. */
export default function ReplayControls({
  segments,
  total,
  at,
  onAt,
  colors,
  onClose,
}: {
  segments: ReplaySegment[]
  total: number
  at: number
  onAt: (at: number) => void
  colors: [string, string][]
  onClose: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 4>(1)
  const atRef = useRef(at)
  atRef.current = at

  // ganze Saison in ~40 s (bei 1×)
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = atRef.current + ((now - last) * total * speed) / 40_000
      last = now
      if (next >= total) {
        onAt(total)
        setPlaying(false)
        return
      }
      onAt(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, total, onAt])

  const st = replayState(segments, at)
  const cur = st.current != null ? segments[st.current] : st.done > 0 ? segments[st.done - 1] : segments[0]
  const curTime = cur ? new Date(Date.parse(cur.startedAt) + (st.current != null ? cur.offsets[st.upTo] : 0)) : null

  return (
    <div className="space-y-2 border-t bg-gray-50 p-2 text-xs">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (at >= total) onAt(0)
            setPlaying((p) => !p)
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-700 text-lg text-white"
          aria-label={playing ? 'Pause' : 'Abspielen'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={total}
          step={Math.max(1, Math.round(total / 1000))}
          value={at}
          onChange={(e) => {
            setPlaying(false)
            onAt(Number(e.target.value))
          }}
          className="min-w-0 flex-1"
          aria-label="Wiedergabe-Zeitpunkt"
        />
        <button
          type="button"
          onClick={() => setSpeed((s) => (s === 1 ? 4 : 1))}
          className="min-h-11 rounded px-2 font-semibold text-gray-700"
          title="Tempo"
        >
          {speed}×
        </button>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded text-gray-500" aria-label="Wiedergabe schliessen">
          ×
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-700">
          {cur && curTime ? `${curTime.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })} · ${cur.work}` : ''}
          <span className="font-normal text-gray-500">
            {' '}
            · Fahrt {Math.min(segments.length, (st.current ?? st.done - 1) + 1)} von {segments.length}
          </span>
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {colors.map(([w, c]) => (
            <span key={w} className="flex items-center gap-1 text-gray-700">
              <span className="inline-block h-1 w-4 rounded" style={{ background: c }} />
              {w}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}
