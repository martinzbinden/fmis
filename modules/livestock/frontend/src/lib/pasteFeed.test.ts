import { describe, expect, it } from 'vitest'
import { checkFeed, readUnit, type FeedValue } from './pasteFeed'

// Nur erfundene Werte
const groups = [
  { id: 'g1', name: 'Mastlämmer Herbst' },
  { id: 'g2', name: 'Mastlämmer Frühling' },
]
const row = (p: Record<string, unknown> = {}) => ({ gruppe: 'Mastlämmer Herbst', datum: '2026-08-20', futterart: 'Lämmermastfutter', menge: 500, einheit: 'kg', kosten: 420, ...p })

describe('Futter einfügen', () => {
  it('liest einen Posten und findet die Gruppe über den Namen', () => {
    const [r] = checkFeed([row({ gruppe: ' mastlämmer  herbst ', lieferant: 'Futtermühle' })], groups, [])
    expect(r.status).toBe('neu')
    expect(r.value as FeedValue).toEqual({ group_id: 'g1', date: '2026-08-20', feed_type: 'Lämmermastfutter', quantity: 500, unit: 'kg', cost_total: 420, supplier: 'Futtermühle', notes: null })
  })

  it('Pflichtangaben und unbekannte Gruppe sind Fehler', () => {
    const rows = checkFeed([row({ gruppe: 'Gibt es nicht' }), row({ datum: '' }), row({ menge: 0 }), row({ futterart: null }), row({ einheit: 'Fuder' })], groups, [])
    expect(rows.map((r) => r.status)).toEqual(['fehler', 'fehler', 'fehler', 'fehler', 'fehler'])
    expect(rows[0].problems[0]).toContain('nicht gefunden')
    expect(rows[1].problems).toContain('datum fehlt')
  })

  it('doppelt: schon erfasst oder zweimal im Block', () => {
    const existing = [{ group_id: 'g1', date: '2026-08-20', feed_type: 'lämmermastfutter', quantity: 500, unit: 'kg' }]
    expect(checkFeed([row()], groups, existing)[0].status).toBe('doppelt')
    const rows = checkFeed([row({ menge: 300 }), row({ menge: 300 }), row({ menge: 300, gruppe: 'Mastlämmer Frühling' })], groups, existing)
    expect(rows.map((r) => r.status)).toEqual(['neu', 'doppelt', 'neu'])
  })

  it('Einheit: Vorgabe kg, Stück und Ballen tolerant', () => {
    expect(readUnit(undefined)).toBe('kg')
    expect(readUnit('Stk.')).toBe('Stück')
    expect(readUnit('ballen')).toBe('Ballen')
    expect(readUnit('Fuder')).toBeNull()
  })

  it('ohne Kosten nur ein Hinweis', () => {
    const [r] = checkFeed([row({ kosten: undefined })], groups, [])
    expect(r.status).toBe('neu')
    expect(r.warnings[0]).toContain('ohne Kosten')
  })
})
