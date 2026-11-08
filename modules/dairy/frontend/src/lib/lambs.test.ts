import { describe, expect, it } from 'vitest'
import { buildLambs, nursingByDam, unmarkedLabel, type LambInput } from './lambs'

const TODAY = '2026-11-08'
const base = (): LambInput => ({
  births: [
    { id: 'b1', dam_id: 'aue1', birth_date: '2026-09-20' },
    { id: 'b2', dam_id: 'aue2', birth_date: '2026-11-01' },
    { id: 'b3', dam_id: 'aue3', birth_date: '2024-03-01' },
  ],
  offspring: [
    { id: 'o1', birth_id: 'b1', animal_key: 'CH1', sex: 'w', stillborn: false, died_24h: false, died_on: null, birth_weight_kg: 4 },
    { id: 'o2', birth_id: 'b1', animal_key: null, sex: 'm', stillborn: true, died_24h: false, died_on: null, birth_weight_kg: null },
    { id: 'o3', birth_id: 'b2', animal_key: null, sex: 'm', stillborn: false, died_24h: false, died_on: null, birth_weight_kg: 3.5 },
    { id: 'o4', birth_id: 'b3', animal_key: null, sex: 'w', stillborn: false, died_24h: false, died_on: null, birth_weight_kg: null },
  ],
  animals: [
    { id: 'l1', ear_tag: 'CH1', lauf_nr: null, name: null, birth_date: '2026-09-20', sex: 'w', status: 'aktiv' },
    { id: 'aue1', ear_tag: 'CH9', lauf_nr: '101', name: null, birth_date: '2020-02-01', sex: 'w', status: 'aktiv' },
    { id: 'zukauf', ear_tag: 'CH5', lauf_nr: null, name: null, birth_date: '2026-08-01', sex: 'm', status: 'aktiv' },
  ],
  weanings: [],
  weights: [],
})

describe('buildLambs', () => {
  it('nimmt lebende Jungtiere bis ein Jahr, mit und ohne Ohrmarke, auch ohne erfasste Geburt', () => {
    const lambs = buildLambs(base(), TODAY)
    expect(lambs.map((l) => l.key)).toEqual(['zukauf', 'o1', 'o3'])
    expect(lambs.find((l) => l.key === 'o1')).toMatchObject({ animalId: 'l1', ageDays: 49, litter: 2, damId: 'aue1', nursing: true })
    expect(lambs.find((l) => l.key === 'o3')).toMatchObject({ animalId: null, earTag: null, ageDays: 7 })
  })

  it('gilt nach dem Absetzen oder ab dem Höchstalter nicht mehr als saugend', () => {
    const input = base()
    input.weanings = [{ offspring_id: null, animal_id: 'l1', wean_date: '2026-11-05' }]
    const lambs = buildLambs(input, TODAY)
    expect(lambs.find((l) => l.key === 'o1')).toMatchObject({ nursing: false, weanDate: '2026-11-05' })
    expect(lambs.find((l) => l.key === 'zukauf')?.nursing).toBe(false) // ohne bekannte Mutter
    expect(nursingByDam(lambs)).toEqual(new Map([['aue2', 1]]))
  })

  it('rechnet die Tageszunahme ab Geburtsgewicht', () => {
    const input = base()
    input.weights = [
      { offspring_id: 'o1', animal_id: null, weigh_date: '2026-10-20', weight_kg: 10 },
      { offspring_id: null, animal_id: 'l1', weigh_date: '2026-11-04', weight_kg: 13 },
    ]
    const l = buildLambs(input, TODAY).find((x) => x.key === 'o1')!
    expect(l.weights.map((w) => w.kg)).toEqual([10, 13])
    expect(l.gainPerDay).toBe(Math.round((9 * 1000) / 45))
  })

  it('verknüpft eine Ohrmarke nur mit dem Tier gleichen Geburtsdatums', () => {
    const input = base()
    input.animals[0].birth_date = '2019-01-01'
    const l = buildLambs(input, TODAY).find((x) => x.key === 'o1')!
    expect(l.animalId).toBeNull()
  })

  it('kennzeichnet Lämmer ohne Ohrmarke mit Meldezeitpunkt, Nummer im Wurf und Mutter', () => {
    expect(unmarkedLabel({ reportedAt: '2026-11-02T13:32:00', birthDate: '2026-11-02', litter: 3, litterIndex: 2 }, '101')).toBe('gemeldet 2.11. 13:32 · 2/3 · Mutter 101')
    expect(unmarkedLabel({ reportedAt: null, birthDate: '2026-11-02', litter: 1, litterIndex: 1 }, null)).toBe('geboren 2.11.')
  })

  it('lässt abgegangene Tiere weg', () => {
    const input = base()
    input.animals[0].status = 'abgegangen'
    expect(buildLambs(input, TODAY).some((l) => l.key === 'o1')).toBe(false)
  })
})
