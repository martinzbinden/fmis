import { describe, expect, it, vi } from 'vitest'

const writes: { table: string; row: Record<string, unknown> }[] = []
vi.mock('../db/write', () => ({
  upsertRow: vi.fn(async (table: string, row: Record<string, unknown>) => void writes.push({ table, row })),
  softDeleteRow: vi.fn(async () => undefined),
}))

import { ACTIVITIES, activityByTitle, areaFor, cancelledFields, cancelWorkTask, joinCustomer, shopRefOf, splitCustomer, type WorkTask } from './workTasks'

describe('Arbeiten planen', () => {
  it('Bereich aus Zielen und Tätigkeit', () => {
    const holz = activityByTitle('Holz spalten')!
    expect(areaFor([], holz)).toBe('brennholz')
    expect(areaFor([{ kind: 'gruppe', id: 'g', label: 'Galtschafe' }], activityByTitle('Klauen schneiden')!)).toBe('tiere')
    expect(areaFor([{ kind: 'maschine', id: 'm', label: 'Mäher' }], null)).toBe('maschine')
    expect(areaFor([{ kind: 'objekt', label: 'Schafstall' }], null)).toBe('gebaeude')
    expect(areaFor([], null)).toBe('frei')
  })
  it('Tätigkeiten haben eindeutige Schlüssel, Tierarbeiten eine Stalljournal-Kategorie', () => {
    expect(new Set(ACTIVITIES.map((a) => a.key)).size).toBe(ACTIVITIES.length)
    expect(ACTIVITIES.filter((a) => a.area === 'tiere').every((a) => a.category)).toBe(true)
    expect(ACTIVITIES.filter((a) => a.area === 'maschine').every((a) => a.logType)).toBe(true)
  })
})

describe('Pendenzen', () => {
  it('Herkunft aus source_ref', async () => {
    const { followUpOf } = await import('./workTasks')
    expect(followUpOf({ source: 'nachfolge', source_ref: 'farm_journal:abc' })).toEqual({ kind: 'farm_journal', id: 'abc' })
    expect(followUpOf({ source: 'manuell', source_ref: null })).toBeNull()
    expect(followUpOf({ source: 'shop', source_ref: '123' })).toBeNull()
  })
})

const task = (over: Partial<WorkTask>): WorkTask => ({
  id: 't1',
  title: 'Liefern: Brennholz',
  area: 'brennholz',
  targets: [],
  planned_date: '2026-03-02',
  due_date: null,
  person_id: null,
  quantity: 3,
  unit: 'Ster',
  notes: null,
  source: 'manuell',
  source_ref: null,
  customer: null,
  status: 'offen',
  done_date: null,
  done_by: null,
  result_notes: null,
  journal_refs: null,
  created_by: null,
  ...over,
})

describe('Absagen', () => {
  const shop = task({ source: 'shop', source_ref: 'r1', customer: 'Erika Beispiel', notes: 'Anfrage AB12 · Lieferung\nTel. 000 000 00 00\nAdresse: Musterweg 1\nKundschaft: bitte vor dem Haus' })
  it('Shop-Arbeit: nur der Verweis bleibt, keine Kontaktdaten', () => {
    expect(shopRefOf(shop)).toBe('Anfrage AB12 · Lieferung')
    expect(cancelledFields(shop)).toEqual({ status: 'abgesagt', notes: 'Anfrage AB12 · Lieferung', customer: 'Anfrage AB12' })
  })
  it('eigene Arbeit: Notiz und Kunde bleiben', () => {
    const own = task({ customer: 'Hans Muster', notes: 'hinter der Scheune' })
    expect(shopRefOf(own)).toBeNull()
    expect(cancelledFields(own)).toEqual({ status: 'abgesagt', notes: 'hinter der Scheune', customer: 'Hans Muster' })
  })
  it('cancelWorkTask schreibt die gekürzte Notiz und meldet die Shop-Herkunft', async () => {
    writes.length = 0
    expect(await cancelWorkTask(shop)).toEqual({ fromShop: true })
    expect(writes).toHaveLength(1)
    expect(writes[0].table).toBe('work_tasks')
    expect(writes[0].row).toEqual({ id: 't1', status: 'abgesagt', notes: 'Anfrage AB12 · Lieferung', customer: 'Anfrage AB12' })
    expect(JSON.stringify(writes[0].row)).not.toMatch(/Tel\.|Musterweg|Erika/)
  })
})

describe('Betriebsjournal: Kunde und Lieferschein', () => {
  it('zerlegen und wieder zusammensetzen', () => {
    expect(splitCustomer('Hans Muster · Lieferschein 2301')).toEqual({ customer: 'Hans Muster', deliveryNoteNo: '2301' })
    expect(splitCustomer('Anfrage AB12 · Lieferung · Lieferschein 7')).toEqual({ customer: 'Anfrage AB12 · Lieferung', deliveryNoteNo: '7' })
    expect(splitCustomer('Hans Muster')).toEqual({ customer: 'Hans Muster', deliveryNoteNo: '' })
    expect(splitCustomer(null)).toEqual({ customer: '', deliveryNoteNo: '' })
    expect(joinCustomer('Hans Muster', '2301')).toBe('Hans Muster · Lieferschein 2301')
    expect(joinCustomer(' ', '')).toBeNull()
    expect(joinCustomer('', '5')).toBe('Lieferschein 5')
  })
})
