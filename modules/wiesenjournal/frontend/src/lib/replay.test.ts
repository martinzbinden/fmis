import { describe, expect, it } from 'vitest'
import { buildReplay, replayState, type ReplayTrackInput } from './replay'

const line = (n: number) => JSON.stringify({ type: 'LineString', coordinates: Array.from({ length: n }, (_, i) => [7.5 + i * 0.001, 46.8]) })
const track = (id: string, start: string, n: number, stepS: number | null, work: string | null = 'Mähen'): ReplayTrackInput => ({
  id,
  label: null,
  work_type: work,
  started_at: start,
  ended_at: new Date(Date.parse(start) + (n - 1) * 1000 * (stepS ?? 10)).toISOString(),
  geometry: line(n),
  point_times: stepS == null ? null : JSON.stringify(Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * stepS * 1000).toISOString())),
})

describe('buildReplay', () => {
  it('reiht Fahrten ohne Pausen aneinander, sortiert nach Beginn', () => {
    const { segments, total } = buildReplay([track('b', '2026-10-14T08:00:00Z', 3, 30), track('a', '2026-09-29T20:00:00Z', 5, 2)])
    expect(segments.map((s) => [s.id, s.start, s.duration])).toEqual([
      ['a', 0, 8000],
      ['b', 8000, 60000],
    ])
    expect(total).toBe(68000)
    expect(segments[0].points[0]).toEqual([46.8, 7.5])
  })
  it('verteilt Punkte ohne Zeitstempel gleichmässig', () => {
    const { segments } = buildReplay([track('a', '2026-09-29T20:00:00Z', 3, null)])
    expect(segments[0].offsets).toEqual([0, 30000, 60000])
    expect(segments[0].work).toBe('Mähen')
  })
  it('nimmt Zeitpunkte auch als Date (PGlite)', () => {
    const t = track('a', '2026-09-29T20:00:00Z', 3, null)
    const { segments } = buildReplay([{ ...t, started_at: new Date(t.started_at as string), ended_at: new Date(t.ended_at as string) }])
    expect(segments[0].startedAt).toBe('2026-09-29T20:00:00.000Z')
    expect(segments[0].duration).toBe(60000)
  })
})

describe('replayState', () => {
  it('liefert fertige Spuren und den Punkt der laufenden', () => {
    const { segments } = buildReplay([track('a', '2026-09-29T20:00:00Z', 5, 2), track('b', '2026-10-14T08:00:00Z', 3, 30)])
    expect(replayState(segments, 0)).toEqual({ done: 0, current: 0, upTo: 0 })
    expect(replayState(segments, 5000)).toEqual({ done: 0, current: 0, upTo: 2 })
    expect(replayState(segments, 8000 + 45000)).toEqual({ done: 1, current: 1, upTo: 1 })
    expect(replayState(segments, 999999)).toEqual({ done: 2, current: null, upTo: 0 })
  })
})
