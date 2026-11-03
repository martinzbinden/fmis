// Wiedergabe der Feldarbeiten (components/ReplayLayer.tsx): GPS-Spuren der Saison
// nacheinander abspielen. Die Zeitachse ist die reine Fahrzeit — Pausen zwischen
// den Fahrten (Nächte, Wochen) werden übersprungen, damit nichts leer läuft.

export interface ReplayTrackInput {
  id: string
  label: string | null
  work_type: string | null
  /** PGlite liefert timestamptz als Date */
  started_at: string | Date
  ended_at: string | Date | null
  geometry: string | null
  point_times: string | null
}

export interface ReplaySegment {
  id: string
  work: string
  label: string
  startedAt: string
  /** [lat, lng] */
  points: [number, number][]
  /** Zeit je Punkt ab Fahrtbeginn in ms (aufsteigend) */
  offsets: number[]
  /** Beginn auf der Wiedergabe-Zeitachse in ms */
  start: number
  duration: number
}

export const workOf = (t: { work_type: string | null; label: string | null }) => t.work_type?.trim() || t.label?.trim() || 'ohne Angabe'

const iso = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

export function buildReplay(tracks: ReplayTrackInput[]): { segments: ReplaySegment[]; total: number } {
  const segments: ReplaySegment[] = []
  let cursor = 0
  const sorted = tracks.map((t) => ({ ...t, started_at: iso(t.started_at)!, ended_at: iso(t.ended_at) })).sort((a, b) => a.started_at.localeCompare(b.started_at))
  for (const t of sorted) {
    if (!t.geometry) continue
    const coords = (JSON.parse(t.geometry) as { coordinates: [number, number][] }).coordinates
    if (coords.length < 2) continue
    const points = coords.map(([lng, lat]) => [lat, lng] as [number, number])
    let times: number[] | null = null
    try {
      const raw = t.point_times ? (JSON.parse(t.point_times) as string[]) : null
      if (raw && raw.length === points.length) times = raw.map((s) => Date.parse(s))
    } catch {
      times = null
    }
    const t0 = times?.[0] ?? Date.parse(t.started_at)
    let offsets: number[]
    if (times && times.every((x) => Number.isFinite(x))) {
      // nie rückwärts (Uhrsprünge im Gerät)
      let last = 0
      offsets = times.map((x) => (last = Math.max(last, x - t0)))
    } else {
      // ohne Zeitstempel gleichmässig von Start bis Ende
      const dur = Math.max(60_000, (t.ended_at ? Date.parse(t.ended_at) : t0) - t0)
      offsets = points.map((_, i) => (dur * i) / (points.length - 1))
    }
    const duration = Math.max(1000, offsets[offsets.length - 1])
    segments.push({ id: t.id, work: workOf(t), label: t.label ?? workOf(t), startedAt: t.started_at, points, offsets, start: cursor, duration })
    cursor += duration
  }
  return { segments, total: cursor }
}

/** Stand bei Wiedergabezeit `at`: fertige Spuren ganz, die laufende bis zum Punkt `upTo` (inklusive). */
export function replayState(segments: ReplaySegment[], at: number): { done: number; current: number | null; upTo: number } {
  let done = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (at >= s.start + s.duration) {
      done = i + 1
      continue
    }
    if (at < s.start) break
    const rel = at - s.start
    let upTo = 0
    // binäre Suche: letzter Punkt mit offset <= rel
    let lo = 0
    let hi = s.offsets.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (s.offsets[mid] <= rel) {
        upTo = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return { done, current: i, upTo }
  }
  return { done, current: null, upTo: 0 }
}
