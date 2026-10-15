// Laufende GPS-Aufzeichnung als eigene Sitzung, unabhängig von der Seite:
// läuft weiter, wenn man in FMIS woanders hin geht (Badge, components/
// TrackingBadge.tsx), sichert jeden Punkt auf dem Gerät und setzt nach einem
// Abbruch (Absturz, Neuladen, Herunterziehen) beim nächsten Start fort.
//
// Ein Schreiber für die Spur (persist): Punkte, Nulllinie und Angaben gehen
// immer zusammen in die Zeile — upsertRow schreibt die ganze Zeile.

import { useSyncExternalStore } from 'react'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'
import { pointsToTrackFields, type StartTrackDetails, type TrackPoint } from './tracking'
import { acceptFix, gapDecision, pointsFromTrack } from './trackFilter'
import type { GuideRef } from './guidance'
import type { Track } from '../types'

const LS_KEY = 'wiesenjournal_active_track_v1'
/** Älter: nicht mehr fortsetzen, sondern beim letzten Punkt abschliessen. */
const RESUME_MAX_AGE_MS = 12 * 3600_000

export interface Fix {
  lat: number
  lng: number
  accuracyM: number | null
  timestamp: number
  /** vom GPS, falls geliefert */
  speedMs: number | null
}

export interface SessionNotice {
  kind: 'fortgesetzt' | 'neue_spur' | 'abgeschlossen' | 'fehler'
  text: string
}

export interface SessionState {
  track: Track | null
  points: TrackPoint[]
  fix: Fix | null
  ref: GuideRef | null
  gpsError: string | null
  /** verworfene Punkte (ungenau/Sprung) seit Start */
  rejected: number
  notice: SessionNotice | null
  /** Fortsetzungsprüfung beim Start erledigt */
  checked: boolean
}

let state: SessionState = { track: null, points: [], fix: null, ref: null, gpsError: null, rejected: 0, notice: null, checked: false }
const listeners = new Set<() => void>()
function set(patch: Partial<SessionState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const subscribeSession = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const getSession = () => state
export function useTrackingSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSession)
}

// --- Speichern ---

/** Einen festen Stand einer Spur schreiben. */
async function writeTrack(t: Track, points: TrackPoint[], ref: GuideRef | null, extra: Partial<Track> = {}): Promise<void> {
  const { geometry, point_times } = pointsToTrackFields(points)
  await upsertRow('tracks', { ...t, ...extra, geometry, point_times, point_count: points.length, guide_ref: ref ? JSON.stringify(ref) : null } as never)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let saving = false
let saveAgain = false
/** Laufende Spur zwischenspeichern (nicht gestapelt: läuft eins, folgt danach eins). */
async function persist(): Promise<void> {
  const t = state.track
  if (!t) return
  if (saving) {
    saveAgain = true
    return
  }
  saving = true
  try {
    await writeTrack(t, state.points, state.ref)
  } catch (e) {
    console.error('Spur speichern', e)
  } finally {
    saving = false
    if (saveAgain) {
      saveAgain = false
      void persist()
    }
  }
}

let lsTimer: ReturnType<typeof setTimeout> | null = null
/** Gerätesicherung (alle 3 s): übersteht Absturz und Neuladen. */
function backupSoon() {
  if (lsTimer) return
  lsTimer = setTimeout(() => {
    lsTimer = null
    backupNow()
  }, 3000)
}
function backupNow() {
  try {
    if (state.track) localStorage.setItem(LS_KEY, JSON.stringify({ track: state.track, points: state.points, ref: state.ref }))
    else localStorage.removeItem(LS_KEY)
  } catch {
    // Speicher voll/gesperrt — die Datenbank-Sicherung alle 10 Punkte bleibt
  }
}

// --- GPS ---

let watchId: number | null = null
let wakeLock: WakeLockSentinel | null = null
/** Nach dem Fortsetzen: erster neuer Punkt entscheidet über Verbinden oder neue Spur */
let resumePending = false

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen')
  } catch {
    // Energiesparmodus o.ä.
  }
}
function onVisible() {
  if (document.visibilityState === 'visible' && state.track) void requestWakeLock()
  // beim Verlassen sofort sichern (Seite kann danach beendet werden)
  if (document.visibilityState === 'hidden') {
    backupNow()
    void persist()
  }
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  backupNow()
  if (state.track) e.preventDefault()
}

function startWatch() {
  if (watchId != null) return
  if (!('geolocation' in navigator)) {
    set({ gpsError: 'GPS ist auf diesem Gerät/Browser nicht verfügbar.' })
    return
  }
  watchId = navigator.geolocation.watchPosition(onFix, (err) => set({ gpsError: err.message || 'GPS-Fehler' }), {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 20000,
  })
  void requestWakeLock()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('beforeunload', onBeforeUnload)
  // Herunterziehen lädt die Seite neu (Android): während der Aufzeichnung aus
  document.documentElement.style.overscrollBehavior = 'none'
  document.body.style.overscrollBehavior = 'none'
}

function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  void wakeLock?.release().catch(() => undefined)
  wakeLock = null
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.documentElement.style.overscrollBehavior = ''
  document.body.style.overscrollBehavior = ''
}

function newTrackRow(seasonYear: number, d: StartTrackDetails): Track {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    season_year: seasonYear,
    label: d.label,
    started_at: now,
    ended_at: null,
    width_m: d.widthM,
    geometry: null,
    point_times: '[]',
    point_count: 0,
    notes: null,
    created_by: getCurrentUserEmail(),
    updated_at: now,
    deleted_at: null,
    work_type: d.workType,
    machine: d.machine,
    operator: d.operator,
    machine_id: d.machineId ?? null,
    tractor_id: d.tractorId ?? null,
    guide_ref: null,
  }
}

function onFix(pos: GeolocationPosition) {
  const fix: Fix = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
    timestamp: pos.timestamp,
    speedMs: pos.coords.speed != null && Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
  }
  set({ fix, gpsError: null })
  if (!state.track) return
  const point: TrackPoint = { lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp }
  const last = state.points[state.points.length - 1] ?? null

  if (resumePending && last) {
    const v = acceptFix(null, point, fix.accuracyM)
    if (!v.ok) {
      set({ rejected: state.rejected + 1 })
      return
    }
    resumePending = false
    const g = gapDecision(last, point)
    if (!g.join) {
      // alte Spur beim letzten Punkt abschliessen, neue mit gleichen Angaben
      const old = state.track
      const oldPoints = state.points
      const ref = state.ref
      void (async () => {
        while (saving) await sleep(50)
        await writeTrack(old, oldPoints, ref, { ended_at: new Date(last.timestamp).toISOString() }).catch((e) => console.error('Spur abschliessen', e))
      })()
      const next: Track = { ...old, id: crypto.randomUUID(), started_at: new Date(point.timestamp).toISOString(), ended_at: null, label: old.label ? `${old.label} (Fortsetzung)` : 'Fortsetzung', geometry: null, point_times: '[]', point_count: 0 }
      set({
        track: next,
        points: [point],
        notice: { kind: 'neue_spur', text: `Unterbruch ${Math.round(g.gapS / 60)} min / ${Math.round(g.gapM)} m: neue Spur begonnen, Nulllinie übernommen.` },
      })
      void persist()
      backupNow()
      return
    }
    set({
      points: [...state.points, point],
      notice: { kind: 'fortgesetzt', text: g.gapS > 5 ? `Aufzeichnung fortgesetzt — Lücke von ${Math.round(g.gapS)} s / ${Math.round(g.gapM)} m gerade verbunden.` : 'Aufzeichnung fortgesetzt.' },
    })
    backupSoon()
    return
  }

  const v = acceptFix(last, point, fix.accuracyM)
  if (!v.ok) {
    set({ rejected: state.rejected + 1 })
    return
  }
  const points = [...state.points, point]
  set({ points })
  backupSoon()
  if (points.length % 10 === 0) void persist()
}

// --- Bedienung ---

export function startSession(seasonYear: number, details: StartTrackDetails, ref: GuideRef | null = null): Track {
  const track = newTrackRow(seasonYear, details)
  resumePending = false
  set({ track, points: [], ref, rejected: 0, notice: null, gpsError: null })
  void persist()
  backupNow()
  startWatch()
  return track
}

/** Beenden: GPS aus, Spur abschliessen. Gibt die beendete Spur zurück. */
export async function stopSession(): Promise<Track | null> {
  const t = state.track
  stopWatch()
  if (!t) return null
  const endedAt = new Date().toISOString()
  const points = state.points
  const ref = state.ref
  set({ track: null, points: [], ref: null, notice: null, rejected: 0, fix: null, gpsError: null })
  backupNow()
  // letzten Stand schreiben (nach einem laufenden Zwischenspeichern)
  while (saving) await sleep(50)
  await writeTrack(t, points, ref, { ended_at: endedAt })
  return { ...t, ended_at: endedAt }
}

export function setSessionRef(ref: GuideRef | null) {
  set({ ref })
  backupNow()
  void persist()
}

export function updateSessionTrack(patch: Partial<Pick<Track, 'width_m' | 'work_type' | 'label' | 'machine' | 'machine_id' | 'tractor_id' | 'notes'>>) {
  if (!state.track) return
  set({ track: { ...state.track, ...patch } })
  backupNow()
  void persist()
}

export const dismissNotice = () => set({ notice: null })

/** Spur in die Sitzung übernehmen und GPS starten (Fortsetzen). */
function adopt(track: Track, points: TrackPoint[], ref: GuideRef | null, text: string) {
  resumePending = points.length > 0
  set({ track: { ...track, ended_at: null }, points, ref, rejected: 0, notice: { kind: 'fortgesetzt', text }, gpsError: null })
  backupNow()
  startWatch()
}

function parseRef(s: string | null | undefined): GuideRef | null {
  try {
    return s ? (JSON.parse(s) as GuideRef) : null
  } catch {
    return null
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

/** Offene Spur fortsetzen (aus der Spurenliste). */
export async function resumeTrack(track: Track) {
  if (state.track) return
  adopt({ ...track, started_at: iso(track.started_at) }, pointsFromTrack(track.geometry, track.point_times), parseRef(track.guide_ref), 'Aufzeichnung fortgesetzt.')
}

/** Offene Spur beim letzten Punkt abschliessen. */
export async function closeOpenTrack(track: Track) {
  const pts = pointsFromTrack(track.geometry, track.point_times)
  const end = pts.length ? new Date(pts[pts.length - 1].timestamp).toISOString() : iso(track.started_at)
  await upsertRow('tracks', { ...track, started_at: iso(track.started_at), ended_at: end } as never)
}

let checking: Promise<void> | null = null
/** Beim App-Start einmal: unterbrochene Aufzeichnung dieses Geräts fortsetzen. */
export function ensureResumed(): Promise<void> {
  if (checking) return checking
  checking = (async () => {
    try {
      if (state.track) return
      let saved: { track: Track; points: TrackPoint[]; ref: GuideRef | null } | null = null
      try {
        saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null')
      } catch {
        saved = null
      }
      if (!saved?.track) return
      const pg = await getDb()
      const { rows } = await pg.query<Track>('select * from tracks where id = $1', [saved.track.id])
      const row = rows[0]
      if (row && (row.ended_at || row.deleted_at)) {
        localStorage.removeItem(LS_KEY)
        return
      }
      // längere Punktliste gewinnt (Gerät meist aktueller als die Datenbank)
      const dbPoints = row ? pointsFromTrack(row.geometry, row.point_times) : []
      const points = saved.points.length >= dbPoints.length ? saved.points : dbPoints
      const ref = saved.ref ?? parseRef(row?.guide_ref)
      const track: Track = { ...(row ?? saved.track), ...saved.track, started_at: iso((row ?? saved.track).started_at), guide_ref: ref ? JSON.stringify(ref) : null }
      const lastT = points.length ? points[points.length - 1].timestamp : Date.parse(track.started_at)
      if (Date.now() - lastT > RESUME_MAX_AGE_MS) {
        await writeTrack(track, points, ref, { ended_at: new Date(lastT).toISOString() })
        localStorage.removeItem(LS_KEY)
        set({ notice: { kind: 'abgeschlossen', text: `Unterbrochene Aufzeichnung «${track.work_type ?? track.label ?? 'Spur'}» vom ${new Date(lastT).toLocaleString('de-CH')} wurde abgeschlossen.` } })
        return
      }
      adopt(track, points, ref, 'Unterbrochene Aufzeichnung wird fortgesetzt …')
    } catch (e) {
      console.error('Fortsetzen', e)
    } finally {
      set({ checked: true })
    }
  })()
  return checking
}
