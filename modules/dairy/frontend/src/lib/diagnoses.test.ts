import { describe, expect, it } from 'vitest'
import { DIAGNOSIS_GROUPS, diagnosisByKey, groupsFor } from './diagnoses'

describe('Diagnose-Kurzliste', () => {
  it('Schlüssel sind eindeutig, ICAR-Codes im Format des Schlüssels', () => {
    const all = DIAGNOSIS_GROUPS.flatMap((g) => g.items)
    expect(new Set(all.map((d) => d.key)).size).toBe(all.length)
    for (const d of all) if (d.icar) expect(d.icar).toMatch(/^\d+(\.\d{2})*\.?$/)
  })
  it('je Tierart nur passende Einträge', () => {
    const sheep = groupsFor('sheep').flatMap((g) => g.items.map((d) => d.key))
    const cattle = groupsFor('cattle').flatMap((g) => g.items.map((d) => d.key))
    expect(sheep).toContain('moderhinke')
    expect(sheep).not.toContain('mortellaro')
    expect(cattle).toContain('mortellaro')
    expect(cattle).not.toContain('moderhinke')
    expect(diagnosisByKey('mastitis_akut')?.icar).toBe('1.13.01.02.')
  })
})
