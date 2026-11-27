import { describe, expect, it } from 'vitest'
import { applies, handoverHistory, itemsFor, type HandoverCheck, type HandoverItem } from './handover'

const item = (p: Partial<HandoverItem>): HandoverItem => ({
  id: 'i', text: 'Kontrolle ob saugt', targets: [], type_id: null, animal: 'Schafe', from_date: '2026-11-22', until_date: null, recurring: false,
  created_by: null, created_at: '2026-11-22T06:00:00Z', closed_at: null, ...p,
})
const morgen = { id: 'm', animal: 'Schafe' }
const abend = { id: 'a', animal: 'Schafe' }
const kuh = { id: 'k', animal: 'Kühe' }
const check = (p: Partial<HandoverCheck>): HandoverCheck => ({ id: 'c', item_id: 'i', date: '2026-11-22', type_id: 'm', done_by: null, done_at: '2026-11-22T07:00:00Z', note: null, ...p })

describe('Übergabe zwischen den Diensten', () => {
  it('gilt für die Dienste der Tierart oder einen bestimmten Dienst, im Zeitraum', () => {
    expect(applies(item({}), { date: '2026-11-22', type: morgen })).toBe(true)
    expect(applies(item({}), { date: '2026-11-22', type: kuh })).toBe(false)
    expect(applies(item({ type_id: 'a' }), { date: '2026-11-22', type: morgen })).toBe(false)
    expect(applies(item({ until_date: '2026-11-23' }), { date: '2026-11-24', type: morgen })).toBe(false)
    expect(applies(item({}), { date: '2026-11-21', type: morgen })).toBe(false)
  })

  it('einmalig: abgehakt am Morgen, am Abend nicht mehr offen', () => {
    const i = item({})
    const c = check({})
    expect(itemsFor([i], [c], { date: '2026-11-22', type: morgen }).map((r) => !!r.check)).toEqual([true])
    expect(itemsFor([i], [c], { date: '2026-11-22', type: abend })).toEqual([])
  })

  it('wiederkehrend: jeder Dienst hakt seinen Durchgang ab', () => {
    const i = item({ recurring: true, text: 'Milch mit Flasche geben', until_date: '2026-11-30' })
    const c = check({})
    expect(itemsFor([i], [c], { date: '2026-11-22', type: morgen })[0].check).not.toBeNull()
    expect(itemsFor([i], [c], { date: '2026-11-22', type: abend })[0].check).toBeNull()
    expect(itemsFor([i], [c], { date: '2026-11-23', type: morgen })[0].check).toBeNull()
  })
})

describe('Übergabe: Verlauf', () => {
  it('abgehakte und beendete Punkte samt Bemerkung, neueste zuerst; ältere und offene ohne Haken nicht', () => {
    const flasche = item({ id: 'f', recurring: true, text: 'Milch mit Flasche geben', closed_at: '2026-11-25T18:00:00Z' })
    const saugt = item({ id: 's' })
    const offen = item({ id: 'o', text: 'Fieber messen' })
    const alt = item({ id: 'x', closed_at: '2026-11-01T08:00:00Z' })
    const checks = [
      check({ id: 'c1', item_id: 'f', date: '2026-11-24', done_at: '2026-11-24T07:00:00Z', note: '150 ml' }),
      check({ id: 'c2', item_id: 'f', date: '2026-11-25', done_at: '2026-11-25T07:00:00Z' }),
      check({ id: 'c3', item_id: 's', date: '2026-11-26', done_at: '2026-11-26T06:30:00Z', note: 'saugt gut' }),
      check({ id: 'c4', item_id: 's', date: '2026-11-02', done_at: '2026-11-02T06:30:00Z' }),
    ]
    const h = handoverHistory([flasche, saugt, offen, alt], checks, '2026-11-14')
    expect(h.map((e) => e.item.id)).toEqual(['s', 'f'])
    expect(h[0].checks.map((c) => c.note)).toEqual(['saugt gut'])
    expect(h[1].checks.map((c) => c.id)).toEqual(['c2', 'c1'])
    expect(h[1].last).toBe('2026-11-25T18:00:00Z')
  })
})
