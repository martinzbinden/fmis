import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/write', () => ({ upsertRow: vi.fn(), softDeleteRow: vi.fn() }))
vi.mock('./milkFeed', () => ({ forgetMilkFeedSettings: vi.fn() }))

const { applyView, captureView, parseSettings, viewSignature, viewSync, visibleViews } = await import('./boardViews')
type BoardView = import('./boardViews').BoardView

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}

const view = (id: string, owner: string, shared: boolean, settings = {}): BoardView => ({ id, name: id, owner, shared, settings, updated_at: '2026-01-01T00:00:00Z', deleted: false })

describe('captureView / applyView', () => {
  it('nimmt nur die Schlüssel des Dashboards dieses Moduls', () => {
    const s = memStore({ m_board_kinds: 'gruppen', m_board_sort: 'nr', m_other: 'x', n_board_kinds: 'merklisten' })
    expect(captureView('m', s)).toEqual({ board_kinds: 'gruppen', board_sort: 'nr' })
  })
  it('schreibt die Ansicht und entfernt, was sie nicht enthält', () => {
    const s = memStore({ m_board_kinds: 'gruppen', m_meat_on: '1', m_other: 'x' })
    applyView('m', { board_sort: 'zz' }, s)
    expect(Object.fromEntries(s.m)).toEqual({ m_board_sort: 'zz', m_other: 'x' })
  })
})

describe('parseSettings', () => {
  it('lässt Unbekanntes und Kaputtes weg', () => {
    expect(parseSettings('{"board_kinds":"gruppen","fremd":"x","board_sort":3}')).toEqual({ board_kinds: 'gruppen' })
    expect(parseSettings('kaputt')).toEqual({})
  })
})

describe('visibleViews', () => {
  it('eigene (auch freigegebene) und freigegebene der anderen, private der anderen nicht', () => {
    const all = [view('a', 'ich@hof.test', false), view('b', 'Ich@hof.test', true), view('c', 'du@hof.test', true), view('d', 'du@hof.test', false), { ...view('e', 'ich@hof.test', true), deleted: true }]
    const { mine, others } = visibleViews(all, 'ich@hof.test')
    expect(mine.map((v) => v.id)).toEqual(['a', 'b'])
    expect(others.map((v) => v.id)).toEqual(['c'])
  })
})

describe('viewSync', () => {
  const A = { board_kinds: 'gruppen' }
  const B = { board_kinds: 'merklisten' }
  const C = { board_kinds: 'beides' }
  const cur = { id: 'v', sig: viewSignature(A) }
  it('ohne gemerkte Ansicht nichts', () => expect(viewSync(null, view('v', 'x', false, A), viewSignature(A))).toBe('none'))
  it('gelöscht', () => expect(viewSync(cur, { ...view('v', 'x', false, A), deleted: true }, viewSignature(A))).toBe('gone'))
  it('nicht mehr freigegeben', () => expect(viewSync(cur, view('v', 'x', false, A), viewSignature(A), false)).toBe('gone'))
  it('noch nicht geladen (gleich nach dem Speichern): warten', () => expect(viewSync(cur, undefined, viewSignature(B))).toBe('none'))
  it('gleich', () => expect(viewSync(cur, view('v', 'x', false, A), viewSignature(A))).toBe('same'))
  it('hier geändert', () => expect(viewSync(cur, view('v', 'x', false, A), viewSignature(B))).toBe('changed'))
  it('anderswo gespeichert, hier unverändert → übernehmen', () => expect(viewSync(cur, view('v', 'x', false, B), viewSignature(A))).toBe('adopt'))
  it('beides geändert', () => expect(viewSync(cur, view('v', 'x', false, B), viewSignature(C))).toBe('conflict'))
})
