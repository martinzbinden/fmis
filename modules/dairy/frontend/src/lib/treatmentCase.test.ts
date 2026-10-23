import { describe, expect, it } from 'vitest'
import { treatmentRows, type TreatmentInput } from './treatmentData'

const input: TreatmentInput = {
  animalIds: ['a1'],
  date: '2026-10-27',
  time: '18:00',
  body_system: null,
  diagnosis: 'Mastitis',
  items: [{ medication: 'Mittel B', dose: '5 ml', applications: 1, days: 1, milk_days: 2, meat_days: 5 }],
  administered_by: 'Martin',
  supplier: null,
  factor: 2,
  notes: null,
}
let n = 0
const newId = () => `id-${++n}`

describe('treatmentRows', () => {
  it('neue Behandlung: eigener Fall, keine Korrektur', () => {
    const [r] = treatmentRows(input, newId)
    expect(r.case_id).toBeTruthy()
    expect(r.corrects_id).toBeNull()
  })
  it('Folgebehandlung hängt sich an den bestehenden Fall', () => {
    const [r] = treatmentRows({ ...input, caseId: 'fall-1' }, newId)
    expect(r.case_id).toBe('fall-1')
  })
  it('Korrektur verweist auf den alten Eintrag und bleibt im Fall', () => {
    const [r] = treatmentRows({ ...input, caseId: 'fall-1', correctsId: 'alt-1' }, newId)
    expect(r.case_id).toBe('fall-1')
    expect(r.corrects_id).toBe('alt-1')
  })
  it('mehrere Tiere: nie ein gemeinsamer Fall, keine Korrektur-Verweise', () => {
    const rows = treatmentRows({ ...input, animalIds: ['a1', 'a2'], caseId: 'fall-1', correctsId: 'alt-1' }, newId)
    expect(new Set(rows.map((r) => r.case_id)).size).toBe(2)
    expect(rows.every((r) => r.corrects_id === null)).toBe(true)
  })
})
