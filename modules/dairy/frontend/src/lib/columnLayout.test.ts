import { describe, expect, it } from 'vitest'
import { buildLanes, moveKey, orderColumns } from './columnLayout'

const cols = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key }))
const keys = cols.map((c) => c.key)

describe('orderColumns', () => {
  it('gespeicherte Reihenfolge zuerst, neue Spalten hinten in Grundreihenfolge', () => {
    expect(orderColumns(cols, ['c', 'a']).map((c) => c.key)).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(orderColumns(cols, ['x', 'e']).map((c) => c.key)).toEqual(['e', 'a', 'b', 'c', 'd'])
    expect(orderColumns(cols, []).map((c) => c.key)).toEqual(keys)
  })
})

describe('moveKey', () => {
  it('vor und nach einer anderen Spalte einsortieren', () => {
    expect(moveKey([], keys, 'd', 'b', false)).toEqual(['a', 'd', 'b', 'c', 'e'])
    expect(moveKey([], keys, 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd', 'e'])
    expect(moveKey(['e', 'a'], keys, 'b', 'e', false)).toEqual(['b', 'e', 'a', 'c', 'd'])
  })
  it('auf sich selbst oder unbekannt: nichts ändert sich sinnlos', () => {
    expect(moveKey(keys, keys, 'b', 'b', true)).toEqual(keys)
    expect(moveKey([], keys, 'b', 'zz', true)).toEqual(keys)
  })
})

describe('buildLanes', () => {
  it('aufeinanderfolgende eingeklappte Spalten werden gestapelt', () => {
    const lanes = buildLanes(cols, new Set(['b', 'c', 'e']))
    expect(lanes.map((l) => (l.kind === 'column' ? l.col.key : l.cols.map((c) => c.key).join('+')))).toEqual(['a', 'b+c', 'd', 'e'])
  })
  it('ohne eingeklappte je eine Spur', () => {
    expect(buildLanes(cols, new Set()).every((l) => l.kind === 'column')).toBe(true)
  })
})
