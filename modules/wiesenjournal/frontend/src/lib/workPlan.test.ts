import { describe, expect, it } from 'vitest'
import { buildPlan, pointInGeometry, visitedParcels, type PlannedFertilization, type PlannedUsage } from './workPlan'
import { loadsFor } from './machines'
import type { Machine } from '../types'

const square = (x: number, y: number) =>
  JSON.stringify({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] })

const fert = (id: string, parcel: string, amount: number, extra: Partial<PlannedFertilization> = {}): PlannedFertilization => ({
  id,
  entry_date: '2026-10-05',
  parcel_id: parcel,
  amount,
  unit: 'm3',
  notes: null,
  duengung_code: 'RGv',
  type_id: 'rgv',
  type_name: 'Rindergülle verdünnt 1:1',
  type_code: 'RGv',
  parcel_name: parcel.toUpperCase(),
  parcel_area: 50,
  parcel_geometry: square(0, 0),
  shares: [],
  ...extra,
})

describe('buildPlan', () => {
  it('fasst geplante Düngungen je Tag und Düngerart zusammen', () => {
    const usage: PlannedUsage[] = [
      { id: 'u1', entry_date: '2026-10-05', parcel_id: 'c', usage_type: 'silage', label: null, notes: null, parcel_name: 'C', parcel_area: 80, parcel_geometry: null },
    ]
    const tasks = buildPlan([fert('f1', 'b', 20), fert('f2', 'a', 13), fert('f3', 'a', 6.5, { entry_date: '2026-10-06' })], usage)
    expect(tasks.map((t) => [t.date, t.title, t.work_type])).toEqual([
      ['2026-10-05', 'Rindergülle verdünnt 1:1', 'Gülle ausbringen'],
      ['2026-10-05', 'Silage', 'Mähen'],
      ['2026-10-06', 'Rindergülle verdünnt 1:1', 'Gülle ausbringen'],
    ])
    expect(tasks[0].items.map((i) => [i.parcel_name, i.amount])).toEqual([
      ['A', 13],
      ['B', 20],
    ])
    expect(tasks[0].machine_kinds).toEqual(['guellefass'])
    expect(tasks[1].items[0].usage_ids).toEqual(['u1'])
  })

  it('teilt eine Massnahme über mehrere Parzellen nach Fläche auf', () => {
    const tasks = buildPlan(
      [
        fert('f1', 'a', 30, {
          shares: [
            { parcel_id: 'a', parcel_name: 'A', area_a: 100, geometry: null },
            { parcel_id: 'b', parcel_name: 'B', area_a: 50, geometry: null },
          ],
        }),
      ],
      [],
    )
    expect(tasks[0].items.map((i) => [i.parcel_name, i.amount, i.fertilization_ids])).toEqual([
      ['A', 20, ['f1']],
      ['B', 10, ['f1']],
    ])
  })
})

describe('Fässer und befahrene Parzellen', () => {
  const fass = { capacity: 6.5, capacity_unit: 'm3' } as Machine

  it('rechnet Fässer auf', () => {
    expect(loadsFor(33, 'm3', fass)).toBe(6)
    expect(loadsFor(13, 'm3', fass)).toBe(2)
    expect(loadsFor(10, 't', fass)).toBeNull()
  })

  it('erkennt Punkte in der Parzelle', () => {
    expect(pointInGeometry(0.5, 0.5, square(0, 0))).toBe(true)
    expect(pointInGeometry(1.5, 0.5, square(0, 0))).toBe(false)
    const items = buildPlan([fert('f1', 'a', 10, { parcel_geometry: square(0, 0) }), fert('f2', 'b', 10, { parcel_geometry: square(5, 5) })], [])[0].items
    const pts = [0.1, 0.2, 0.3].map((v) => ({ lat: v, lng: v }))
    expect([...visitedParcels(items, pts)]).toEqual(['a'])
  })
})
