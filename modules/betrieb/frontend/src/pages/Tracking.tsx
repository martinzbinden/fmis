import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useQuery } from '../hooks/useQuery'
import DriveAssist, { assistFields, fmt0, fmt1, GuidanceStrip, loadAssistData, NullLine, useGuidance, useStored, type AssistField, type Guidance } from '../components/DriveAssist'
import StartTrackDialog from '../components/StartTrackDialog'
import TrackMap, { type MapField } from '../components/TrackMap'
import { gpsQuality, TONE, useNow } from '../components/TrackingBadge'
import { closeOpenTrack, dismissNotice, ensureResumed, resumeTrack, startSession, stopSession, updateSessionTrack, useTrackingSession, type SessionState } from '../lib/trackingSession'
import { pointsFromTrack } from '../lib/trackFilter'
import { emptyTank, fieldAt, step } from '../lib/slurry'
import { haversineMeters } from '../lib/geo'
import { downloadGpx } from '../lib/gpx'
import { fmtDate, num } from '../lib/format'
import { getActivePlan, setActivePlan } from '../lib/workPlan'
import type { GuideRef } from '../lib/guidance'
import { deleteTrack, type StartTrackDetails } from '../lib/tracking'
import type { Machine, Track } from '../types'

type Tab = 'fahrhilfe' | 'karte' | 'spuren' | 'geraet'
const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'fahrhilfe', icon: '🧭', label: 'Fahrhilfe' },
  { key: 'karte', icon: '🗺️', label: 'Karte' },
  { key: 'spuren', icon: '📜', label: 'Spuren' },
  { key: 'geraet', icon: '⚙️', label: 'Gerät' },
]
const FROM_KEY = 'wiesenjournal_tracking_from'
const PLOW_ASSISTANT = 'https://claude.ai/artifact/94dMQW57kTxT6iAsHWx3Nc'
const SEASON = new Date().getFullYear()

const toMapFields = (fields: AssistField[]): MapField[] => fields.map((f) => ({ id: f.id, name: f.name, geometry: f.geometry }))
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''))
const dur = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

/** Bildschirm gesperrt: Berührungen gehen nirgends hin, Entsperren nur durch
 * Gedrückthalten (gegen versehentliches Antippen im Traktor). */
function LockOverlay({ onUnlock }: { onUnlock: () => void }) {
  const [p, setP] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setP(0)
  }
  const start = () => {
    stop()
    const t0 = Date.now()
    timer.current = setInterval(() => {
      const f = (Date.now() - t0) / 1200
      setP(Math.min(1, f))
      if (f >= 1) {
        stop()
        onUnlock()
      }
    }, 40)
  }
  useEffect(() => stop, [])
  return (
    <div className="fixed inset-0 z-[1990] touch-none" onPointerDown={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-[calc(env(safe-area-inset-bottom,0px)+14px)]">
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation()
            start()
          }}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          className="relative overflow-hidden rounded-full bg-gray-900/90 px-6 py-4 text-base font-semibold text-white shadow-2xl"
        >
          <span className="absolute inset-y-0 left-0 bg-emerald-500/70" style={{ width: `${p * 100}%` }} />
          <span className="relative">🔒 gesperrt · zum Entsperren gedrückt halten</span>
        </button>
      </div>
    </div>
  )
}

function GpsChip({ s, now }: { s: SessionState; now: number }) {
  if (!s.track) return <span className="shrink-0 rounded-full bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-600">GPS aus</span>
  const q = gpsQuality(s.fix?.accuracyM, s.fix?.timestamp, now)
  return <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${TONE[q.tone]}`}>{q.label}</span>
}

/** Frühere und offene Spuren: Liste, Karte mit Fläche (Gerätebreite) und
 * Bahnen der gespeicherten Nulllinie, Kennzahlen. */
function Tracks({ fields, s, selectedId, onSelect }: { fields: AssistField[]; s: SessionState; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const navigate = useNavigate()
  const canWrite = useHasPermission('betrieb:tracking:write')
  const { data: tracks, refresh } = useQuery(
    (pg) => pg.query<Track>('select * from tracks where deleted_at is null order by started_at desc limit 150').then((r) => r.rows.map((t) => ({ ...t, started_at: iso(t.started_at), ended_at: t.ended_at ? iso(t.ended_at) : null }))),
    [s.track?.id],
  )
  const [busy, setBusy] = useState(false)
  const sel = tracks?.find((t) => t.id === selectedId) ?? null
  const detail = useMemo(() => {
    if (!sel) return null
    const pts = pointsFromTrack(sel.geometry, sel.point_times)
    let len = 0
    for (let i = 1; i < pts.length; i++) len += haversineMeters(pts[i - 1], pts[i])
    let st = emptyTank()
    for (const p of pts) st = step(st, { lat: p.lat, lng: p.lng, t: p.timestamp }, fields).state
    const width = num(sel.width_m)
    let ref: GuideRef | null = null
    try {
      ref = sel.guide_ref ? (JSON.parse(sel.guide_ref) as GuideRef) : null
    } catch {
      ref = null
    }
    const end = pts.length ? pts[pts.length - 1].timestamp : Date.parse(sel.started_at)
    return { pts, len, areaA: width ? (st.distM * width) / 100 : null, width, ref, durMs: end - Date.parse(sel.started_at) }
  }, [sel, fields])
  const mid = detail?.pts[Math.floor(detail.pts.length / 2)]
  const hereId = mid ? (fieldAt(fields, mid)?.id ?? null) : null

  if (!tracks) return <p className="p-4 text-sm text-gray-500">Lädt…</p>
  return (
    <div className="space-y-3 p-3">
      {sel && detail && (
        <section className="space-y-2 rounded-xl border bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-gray-800">
                {sel.work_type ?? sel.label ?? 'Spur'} · {fmtDate(sel.started_at.slice(0, 10))}
              </div>
              <div className="text-xs text-gray-500">
                {sel.machine ?? 'ohne Gerät'}
                {detail.width ? ` · ${fmt1(detail.width)} m` : ''} · {sel.operator ?? ''}
              </div>
            </div>
            <button type="button" onClick={() => onSelect(null)} className="px-2 text-lg text-gray-400" aria-label="Schliessen">
              ×
            </button>
          </div>
          <TrackMap
            className="h-[48vh] w-full overflow-hidden rounded-lg"
            fields={toMapFields(fields)}
            hereId={hereId}
            tracks={[{ id: sel.id, points: detail.pts, widthM: detail.width, color: '#7c3aed' }]}
            guide={detail.ref && detail.width ? { ref: detail.ref, widthM: detail.width, worked: new Set(), current: null } : null}
          />
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded bg-gray-50 p-2">
              <div className="text-xs text-gray-500">Dauer</div>
              <div className="font-semibold">{dur(detail.durMs)}</div>
            </div>
            <div className="rounded bg-gray-50 p-2">
              <div className="text-xs text-gray-500">Strecke</div>
              <div className="font-semibold">{fmt1(detail.len / 1000)} km</div>
            </div>
            <div className="rounded bg-gray-50 p-2">
              <div className="text-xs text-gray-500">bearbeitet</div>
              <div className="font-semibold">{detail.areaA != null ? `${fmt0(detail.areaA)} a` : '–'}</div>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Violett breit = befahrene Fläche (Gerätebreite). Nulllinie:{' '}
            {detail.ref ? (detail.ref.source === 'ab' ? 'A-B-Linie' : detail.ref.source === 'feldrand' ? 'Feldrand' : 'gefahrene Bahn') : 'keine gespeichert'}
            {detail.ref ? ' — gestrichelte Linien sind die Bahnen.' : ''} «bearbeitet» zählt Fahrt in Feldrichtung in Parzellen.
          </p>
          <div className="flex flex-wrap gap-2 text-sm">
            {sel.width_m != null && sel.ended_at && (
              <button type="button" onClick={() => navigate(`/wiesenjournal/karte?abdeckung=${sel.id}`)} className="rounded-lg border border-gray-300 px-3 py-2">
                Doppelt / Lücken prüfen
              </button>
            )}
            <button type="button" onClick={() => downloadGpx(sel)} className="rounded-lg border border-gray-300 px-3 py-2">
              GPX
            </button>
            {canWrite && sel.id !== s.track?.id && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(`Spur «${sel.work_type ?? sel.label ?? 'Spur'}» vom ${fmtDate(sel.started_at.slice(0, 10))} löschen?`)) return
                  void deleteTrack(sel).then(() => {
                    onSelect(null)
                    refresh()
                  })
                }}
                className="rounded-lg border border-red-300 px-3 py-2 text-red-700"
              >
                Löschen
              </button>
            )}
          </div>
        </section>
      )}
      <ul className="divide-y rounded-xl border bg-white">
        {tracks.map((t) => {
          const isCurrent = t.id === s.track?.id
          const open = !t.ended_at && !isCurrent
          return (
            <li key={t.id} className={`p-3 text-sm ${t.id === selectedId ? 'bg-brand-50' : ''}`}>
              <button type="button" onClick={() => onSelect(t.id)} className="w-full text-left">
                <span className="font-medium text-gray-800">
                  {fmtDate(t.started_at.slice(0, 10))} {new Date(t.started_at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                  {t.work_type ?? t.label ?? 'Spur'}
                </span>
                {isCurrent && <span className="ml-1 rounded bg-red-100 px-1 text-xs text-red-800">läuft</span>}
                {open && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-900">offen</span>}
                <span className="block text-xs text-gray-500">
                  {t.machine ?? 'ohne Gerät'}
                  {t.width_m ? ` · ${fmt1(Number(t.width_m))} m` : ''} · {t.point_count} Punkte{t.guide_ref ? ' · Nulllinie' : ''}
                </span>
              </button>
              {open && canWrite && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={!!s.track || busy}
                    onClick={() => void resumeTrack(t)}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    title={s.track ? 'Zuerst laufende Aufzeichnung beenden' : ''}
                  >
                    ▶ fortsetzen
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm('Diese Spur beim letzten Punkt abschliessen?')) return
                      setBusy(true)
                      void closeOpenTrack(t)
                        .then(refresh)
                        .finally(() => setBusy(false))
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
                  >
                    abschliessen
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {tracks.length === 0 && <li className="p-3 text-sm text-gray-500">Noch keine Spuren.</li>}
      </ul>
    </div>
  )
}

/** Einstellungen während der Arbeit: Gerät/Breite, Nulllinie, GPS, Sperre. */
function Settings({
  s,
  g,
  machine,
  now,
  autoLock,
  setAutoLock,
}: {
  s: SessionState
  g: Guidance
  machine: Machine | null
  now: number
  autoLock: number
  setAutoLock: (v: number) => void
}) {
  const t = s.track
  const [w, setW] = useState(t?.width_m != null ? String(t.width_m) : '')
  const [work, setWork] = useState(t?.work_type ?? '')
  const plow = /pflug|pflüg/i.test(`${t?.work_type ?? ''} ${t?.machine ?? ''} ${machine?.kind ?? ''}`)
  const q = gpsQuality(s.fix?.accuracyM, s.fix?.timestamp, now)
  const box = 'space-y-2 rounded-xl border bg-white p-3'
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base'
  return (
    <div className="space-y-3 p-3">
      {t && (
        <section className={box}>
          <h3 className="text-sm font-semibold text-gray-700">Arbeit und Gerät</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-gray-600">
              Arbeit
              <input className={input} value={work} onChange={(e) => setWork(e.target.value)} onBlur={() => updateSessionTrack({ work_type: work.trim() || null })} />
            </label>
            <label className="block text-xs text-gray-600">
              Arbeitsbreite (m)
              <input
                className={input}
                inputMode="decimal"
                value={w}
                onChange={(e) => setW(e.target.value)}
                onBlur={() => {
                  const n = Number(w.replace(',', '.'))
                  updateSessionTrack({ width_m: w.trim() && Number.isFinite(n) && n > 0 ? n : null })
                }}
              />
            </label>
          </div>
          <div className="text-xs text-gray-500">Gerät: {t.machine ?? 'keines gewählt'}</div>
          {plow && (
            <a href={PLOW_ASSISTANT} target="_blank" rel="noreferrer" className="inline-block rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">
              Pflug einstellen: Prüfliste öffnen ↗
            </a>
          )}
        </section>
      )}
      {t && (
        <section className={box}>
          <h3 className="text-sm font-semibold text-gray-700">Nulllinie (Bahn 0)</h3>
          <NullLine g={g} storageKey={`wiesenjournal_assist_${t.id}`} />
        </section>
      )}
      <section className={box}>
        <h3 className="text-sm font-semibold text-gray-700">GPS</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[q.tone]}`}>{q.label}</span>
          {s.fix?.speedMs != null && <span className="text-xs text-gray-600">GPS-Tempo {fmt1(s.fix.speedMs * 3.6)} km/h</span>}
          {t && <span className="text-xs text-gray-600">{s.points.length} Punkte · {s.rejected} verworfen (ungenau &gt; 25 m oder Sprung)</span>}
        </div>
        {s.gpsError && <p className="text-xs text-red-700">{s.gpsError}</p>}
        <p className="text-xs text-gray-500">
          Grün ≤ 4 m, gelb ≤ 8 m, rot schlechter. Handy-GPS schafft meist 3–5 m. Besser wird es nur mit einem externen GPS-Empfänger
          (z.B. mit Korrektursignal swipos), den Android als Standortquelle einbindet — dann nutzt FMIS ihn automatisch. Die
          Beschleunigungssensoren des Handys verbessern die Position nicht spürbar (Handy wackelt in der Halterung, Sensoren driften); FMIS
          glättet stattdessen den Querabstand und wirft Ausreisser weg.
        </p>
      </section>
      <section className={box}>
        <h3 className="text-sm font-semibold text-gray-700">Bildschirm</h3>
        <label className="flex items-center justify-between gap-2 text-sm">
          Automatisch sperren beim Fahren nach
          <select value={autoLock} onChange={(e) => setAutoLock(Number(e.target.value))} className="rounded-lg border border-gray-300 px-2 py-1.5">
            <option value={0}>nie</option>
            <option value={10}>10 s</option>
            <option value={20}>20 s</option>
            <option value={45}>45 s</option>
          </select>
        </label>
        <p className="text-xs text-gray-500">Gesperrt bleibt alles sichtbar, Antippen bewirkt nichts. Entsperren: Knopf unten gedrückt halten.</p>
      </section>
    </div>
  )
}

/** Tracking als eigene Arbeitsansicht: Fahrhilfe, Karte, Spuren, Gerät.
 * «← FMIS» führt zurück, die Aufzeichnung läuft weiter (Badge). */
export default function Tracking() {
  const s = useTrackingSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const canTrack = useHasPermission('betrieb:tracking:write')
  const now = useNow(1000)
  const { data } = useQuery((pg) => loadAssistData(pg, SEASON), [])
  const fields = useMemo(() => assistFields(data?.parcels ?? []), [data])
  const machine = data?.machines.find((m) => m.id === s.track?.machine_id) ?? null
  const width = Number(s.track?.width_m ?? machine?.width_m ?? 0) || null
  const g = useGuidance(s.points, fields, width, s.ref)
  const [tab, setTab] = useStored<Tab>('wiesenjournal_tracking_tab', 'fahrhilfe')
  const [starting, setStarting] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [locked, setLocked] = useState(false)
  const [autoLock, setAutoLock] = useStored<number>('wiesenjournal_tracking_autolock', 20)
  const lastTouch = useRef(Date.now())
  const plan = getActivePlan()

  useEffect(() => {
    void ensureResumed()
  }, [])
  // Rücksprung merken
  useEffect(() => {
    const from = (location.state as { from?: string } | null)?.from
    if (from) sessionStorage.setItem(FROM_KEY, from)
  }, [location.state])
  useEffect(() => {
    if (params.get('start') === '1' && canTrack && !s.track) {
      setParams({}, { replace: true })
      setStarting(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canTrack])
  // Auto-Sperre: beim Fahren und ohne Berührung
  useEffect(() => {
    if (!s.track || !autoLock || locked) return
    const moving = (g.speedMs ?? 0) > 1
    if (moving && now - lastTouch.current > autoLock * 1000) setLocked(true)
  }, [now, s.track, autoLock, locked, g.speedMs])
  useEffect(() => {
    if (!s.track) setLocked(false)
  }, [s.track])

  const back = () => {
    let to = '/betrieb/arbeitsplan'
    try {
      to = sessionStorage.getItem(FROM_KEY) || to
    } catch {
      // egal
    }
    navigate(to)
  }
  const start = (d: StartTrackDetails) => {
    setStarting(false)
    startSession(SEASON, d)
    setTab('fahrhilfe')
  }
  const stop = async () => {
    if (!confirm('Aufzeichnung beenden?')) return
    const done = await stopSession()
    if (plan && done) {
      navigate('/betrieb/arbeitsplan?abschluss=1')
      return
    }
    setSelected(done?.id ?? null)
    setTab('spuren')
  }
  const resumePlan = () => {
    if (!plan) return
    const t = startSession(SEASON, {
      label: `${plan.task.title} ${fmtDate(plan.task.date)}`,
      widthM: plan.width_m,
      workType: plan.task.work_type,
      machine: [plan.machine_name, plan.tractor_name].filter(Boolean).join(' + ') || null,
      operator: getCurrentUserEmail(),
      machineId: plan.machine_id,
      tractorId: plan.tractor_id ?? null,
    })
    setActivePlan({ ...plan, track_id: t.id })
  }

  const live = s.track ? [{ id: s.track.id, points: s.points, widthM: width, color: '#7c3aed' }] : []
  const position = s.fix ? { lat: s.fix.lat, lng: s.fix.lng, accuracyM: s.fix.accuracyM } : null

  return (
    <div
      className="fixed inset-0 z-[1900] flex flex-col bg-gray-100 text-gray-900"
      onPointerDownCapture={() => {
        lastTouch.current = Date.now()
      }}
    >
      {/* Kopf */}
      <div className="flex items-center gap-2 border-b bg-white px-2 pb-2 pt-[calc(env(safe-area-inset-top,0px)+8px)]">
        <button type="button" onClick={back} className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold">
          ← FMIS
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{s.track ? (s.track.work_type ?? 'Aufzeichnung') : 'Tracking'}</div>
          <div className="truncate text-xs text-gray-500">
            {s.track ? `${s.track.machine ?? 'ohne Gerät'}${width ? ` · ${fmt1(width)} m` : ''} · ${g.here ? g.here.name : 'ausserhalb'}` : 'keine Aufzeichnung'}
          </div>
        </div>
        <GpsChip s={s} now={now} />
        {s.track && (
          <>
            <button type="button" onClick={() => setLocked(true)} className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-2 text-sm" aria-label="Bildschirm sperren">
              🔒
            </button>
            <button type="button" onClick={() => void stop()} className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white">
              ⏹
            </button>
          </>
        )}
      </div>
      {s.notice && (
        <div className="flex items-start gap-2 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span className="flex-1">{s.notice.text}</span>
          <button type="button" onClick={dismissNotice} className="px-1 text-sky-700" aria-label="Hinweis schliessen">
            ×
          </button>
        </div>
      )}
      {s.gpsError && <div className="bg-red-50 px-3 py-2 text-sm text-red-800">GPS: {s.gpsError}</div>}
      {/* Lenkhilfe bleibt sichtbar, wenn nicht im Register Fahrhilfe */}
      {s.track && tab !== 'fahrhilfe' && g.width && (
        <div className="border-b bg-white px-2 py-1.5">
          <GuidanceStrip g={g} />
        </div>
      )}

      {/* Inhalt */}
      <div className={`min-h-0 flex-1 ${tab === 'karte' ? 'relative' : 'overflow-y-auto'}`}>
        {tab === 'fahrhilfe' &&
          (s.track ? (
            <div className="p-3">
              <DriveAssist
                track={s.track}
                points={s.points}
                accuracyM={s.fix?.accuracyM ?? null}
                seasonYear={SEASON}
                plan={plan}
                g={g}
                fields={fields}
                machine={machine}
                parcels={data?.parcels ?? []}
                focus="lenken"
              />
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-3 p-4 text-center">
              {!s.checked ? (
                <p className="text-sm text-gray-500">Prüfe unterbrochene Aufzeichnung…</p>
              ) : (
                <>
                  <p className="text-sm text-gray-600">Keine Aufzeichnung läuft.</p>
                  {canTrack && (
                    <button type="button" onClick={() => setStarting(true)} className="w-full rounded-xl bg-purple-600 py-4 text-lg font-semibold text-white">
                      ▶ Aufzeichnung starten
                    </button>
                  )}
                  {plan && canTrack && (
                    <button type="button" onClick={resumePlan} className="w-full rounded-xl bg-green-600 py-3 font-semibold text-white">
                      ▶ Arbeitsplan «{plan.task.title}» fortsetzen
                    </button>
                  )}
                  <p className="text-xs text-gray-500">Unterbrochene Aufzeichnungen (Absturz, Neuladen) werden automatisch fortgesetzt. Offene Spuren: Register «Spuren».</p>
                </>
              )}
            </div>
          ))}
        {tab === 'karte' && (
          <>
            <TrackMap
              className="absolute inset-0"
              fields={toMapFields(fields)}
              hereId={g.here?.id ?? null}
              tracks={live}
              guide={s.ref && width ? { ref: s.ref, widthM: width, worked: g.worked, current: g.pos?.lane ?? null } : null}
              position={position}
              follow={follow}
            />
            <button
              type="button"
              onClick={() => setFollow((f) => !f)}
              className={`absolute bottom-3 right-3 z-[1000] rounded-full px-4 py-3 text-sm font-semibold shadow-lg ${follow ? 'bg-brand-700 text-white' : 'bg-white text-gray-800'}`}
            >
              {follow ? '◎ folgt' : '◎ mitfahren'}
            </button>
          </>
        )}
        {tab === 'spuren' && <Tracks fields={fields} s={s} selectedId={selected} onSelect={setSelected} />}
        {tab === 'geraet' && <Settings s={s} g={g} machine={machine} now={now} autoLock={autoLock} setAutoLock={setAutoLock} />}
      </div>

      {/* eigenes Menü */}
      <nav className="grid grid-cols-4 border-t bg-white pb-[env(safe-area-inset-bottom,0px)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-xs ${tab === t.key ? 'font-semibold text-brand-700' : 'text-gray-600'}`}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            <span className="text-xl leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {locked && <LockOverlay onUnlock={() => {
        lastTouch.current = Date.now()
        setLocked(false)
      }} />}
      {starting && <StartTrackDialog onClose={() => setStarting(false)} onStart={start} />}
    </div>
  )
}
