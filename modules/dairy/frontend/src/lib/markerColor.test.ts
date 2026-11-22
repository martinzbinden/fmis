import { describe, expect, it } from 'vitest'
import { currentMarker, nextMarkerColor } from './markerColor'

const m = (sire_key: string | null, service_date: string, marker_color: string | null) => ({ sire_key, service_date, marker_color })

describe('Farbe Deckgurt', () => {
  it('letzte Farbe des Vatertiers, seit Beginn der Folge', () => {
    const rows = [m('A', '2026-09-01', 'blau'), m('A', '2026-09-05', 'blau'), m('A', '2026-09-20', 'gruen'), m('A', '2026-09-25', null), m('A', '2026-09-28', 'gruen'), m('B', '2026-10-01', 'rot')]
    expect(currentMarker(rows, 'A')).toEqual({ color: 'gruen', since: '2026-09-20' })
    expect(currentMarker(rows, 'B')).toEqual({ color: 'rot', since: '2026-10-01' })
  })
  it('ohne Farbe oder ohne Vatertier: keine', () => {
    expect(currentMarker([m('A', '2026-09-01', null)], 'A')).toBeNull()
    expect(currentMarker([m('A', '2026-09-01', 'blau')], null)).toBeNull()
  })
  it('nächste Farbe in der Reihe, nach violett wieder blau', () => {
    expect(nextMarkerColor('blau')).toBe('gruen')
    expect(nextMarkerColor('violett')).toBe('blau')
  })
})
