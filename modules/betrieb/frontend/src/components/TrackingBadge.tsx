import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { syncClient } from '../db/sync'
import { ensureResumed, useTrackingSession } from '../lib/trackingSession'
import { recentSpeed } from '../lib/slurry'

const POS_KEY = 'wiesenjournal_tracking_badge_pos'
const TRACKING_PATH = '/betrieb/tracking'

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** GPS-Qualität: Genauigkeit und Alter des letzten Punkts. */
export function gpsQuality(accuracyM: number | null | undefined, fixAt: number | null | undefined, now: number): { label: string; tone: 'ok' | 'mid' | 'bad' } {
  if (fixAt == null) return { label: 'GPS sucht…', tone: 'bad' }
  const age = (now - fixAt) / 1000
  if (age > 6) return { label: `GPS weg (${Math.round(age)} s)`, tone: 'bad' }
  if (accuracyM == null) return { label: 'GPS', tone: 'mid' }
  const a = Math.round(accuracyM)
  return { label: `GPS ±${a} m`, tone: accuracyM <= 4 ? 'ok' : accuracyM <= 8 ? 'mid' : 'bad' }
}
export const TONE: Record<'ok' | 'mid' | 'bad', string> = { ok: 'bg-emerald-600 text-white', mid: 'bg-amber-500 text-white', bad: 'bg-red-600 text-white' }

const hhmm = (ms: number) => {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
}

/** Schwebendes Badge in ganz FMIS, solange eine Aufzeichnung läuft
 * (verschiebbar, antippen = grösser, «Vollbild» = zurück ins Tracking).
 * Setzt beim App-Start eine unterbrochene Aufzeichnung fort. */
export default function TrackingBadge() {
  const s = useTrackingSession()
  const location = useLocation()
  const navigate = useNavigate()
  const now = useNow(1000)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) ?? '') as { x: number; y: number }
    } catch {
      return { x: 12, y: 96 }
    }
  })
  const drag = useRef<{ sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    void ensureResumed()
  }, [])
  // Spur auch hochladen, wenn das Wiesenjournal gerade nicht offen ist
  useEffect(() => {
    if (s.track) syncClient.startSyncLoop()
  }, [s.track])

  if (!s.track || location.pathname.startsWith(TRACKING_PATH)) return null

  const q = gpsQuality(s.fix?.accuracyM, s.fix?.timestamp, now)
  const speed = recentSpeed(s.points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.timestamp })))
  const started = Date.parse(s.track.started_at)
  const full = () => navigate(TRACKING_PATH, { state: { from: location.pathname + location.search } })

  const onDown = (e: React.PointerEvent) => {
    drag.current = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
    if (d.moved) setPos({ x: Math.max(0, Math.min(window.innerWidth - 80, d.x + dx)), y: Math.max(0, Math.min(window.innerHeight - 60, d.y - dy)) })
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos))
      } catch {
        // egal
      }
    } else setOpen((o) => !o)
  }

  return (
    <div className="fixed z-[2100] select-none" style={{ left: pos.x, bottom: `calc(${pos.y}px + env(safe-area-inset-bottom, 0px))` }}>
      {open && (
        <div className="mb-2 w-64 space-y-2 rounded-2xl bg-white p-3 text-sm shadow-2xl ring-1 ring-black/10">
          <div className="font-semibold text-gray-800">{s.track.work_type ?? s.track.label ?? 'Aufzeichnung'}</div>
          <div className="text-xs text-gray-500">
            {s.track.machine ?? 'ohne Gerät'} · seit {hhmm(now - started)} · {s.points.length} Punkte
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            <span className={`rounded-full px-2 py-0.5 ${TONE[q.tone]}`}>{q.label}</span>
            {speed != null && <span className="rounded-full bg-gray-100 px-2 py-0.5">{(speed * 3.6).toFixed(1)} km/h</span>}
          </div>
          {s.notice && <div className="rounded bg-sky-50 p-1.5 text-xs text-sky-900">{s.notice.text}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={full} className="flex-1 rounded-lg bg-brand-700 px-3 py-2 font-semibold text-white">
              ⛶ Vollbild
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-3 py-2">
              klein
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="flex touch-none items-center gap-2 rounded-full bg-gray-900 py-2 pl-3 pr-4 text-sm font-semibold text-white shadow-xl"
        aria-label="Laufende Aufzeichnung"
      >
        <span className={`h-3 w-3 animate-pulse rounded-full ${q.tone === 'bad' ? 'bg-red-500' : 'bg-red-400'}`} />
        🚜 {hhmm(now - started)}
        <span className={`rounded-full px-1.5 text-[11px] ${TONE[q.tone]}`}>{q.tone === 'bad' && q.label.startsWith('GPS weg') ? 'kein GPS' : q.label.replace('GPS ', '')}</span>
      </button>
    </div>
  )
}
