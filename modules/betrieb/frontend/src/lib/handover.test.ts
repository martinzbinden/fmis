import { describe, expect, it } from 'vitest'
import { applies, itemsFor, type HandoverCheck, type HandoverItem } from './handover'

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
