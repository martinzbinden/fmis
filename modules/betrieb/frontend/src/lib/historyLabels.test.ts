import { describe, expect, it } from 'vitest'
import { describeEntry, TABLE_LABEL } from './historyLabels'

const e = (table_name: string, snap: Record<string, unknown>) => ({ table_name, row_id: '00000000-0000-0000-0000-000000000001', snapshot: JSON.stringify(snap) })

describe('Verlauf: Beschreibung', () => {
  it('Arbeiten, Betriebsjournal, Fotos, Übergaben ohne UUID', () => {
    expect(describeEntry(e('work_tasks', { title: 'Zaun reparieren', status: 'offen', planned_date: '2026-04-03' }))).toBe('Zaun reparieren · offen · 03.04.2026')
    expect(describeEntry(e('work_tasks', { title: 'Holz spalten', status: 'erledigt', planned_date: '2026-04-03', done_date: '2026-04-05' }))).toBe('Holz spalten · erledigt · 05.04.2026')
    expect(describeEntry(e('farm_journal', { title: 'Brennholz liefern', entry_date: '2026-02-01', quantity: '3', unit: 'Ster' }))).toBe('Brennholz liefern · 01.02.2026 · 3 Ster')
    expect(describeEntry(e('photos', { ref_kind: 'work_task', taken_at: '2026-02-01T08:00:00Z', caption: null }))).toBe('Foto zu Arbeit · 01.02.2026')
    expect(describeEntry(e('handover_items', { text: 'Tränke im Stall prüfen', from_date: '2026-02-01' }))).toBe('Tränke im Stall prüfen · 01.02.2026')
    expect(describeEntry(e('handover_checks', { date: '2026-02-02', done_by: 'Test Person' }))).toBe('Erledigt 02.02.2026 · Test Person')
  })
  it('Bereichsnamen vorhanden', () => {
    for (const t of ['work_tasks', 'farm_journal', 'photos', 'handover_items', 'handover_checks']) expect(TABLE_LABEL[t]).toBeTruthy()
  })
})
