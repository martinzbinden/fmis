import { describe, expect, it } from 'vitest'
import { parseAdisFiles } from './importAdis'

/** Satz mit Feldern an den Spec-Positionen (1-basiert, inklusiv). */
function record(type: string, fields: [number, string][]): string {
  const chars = Array.from({ length: 140 }, () => ' ')
  type.split('').forEach((c, i) => (chars[i] = c))
  for (const [from, value] of fields) value.split('').forEach((c, i) => (chars[from - 1 + i] = c))
  return chars.join('')
}

const test = (type: string, date: string) =>
  record(type, [
    [23, 'CH113000000001'],
    [69, '20260130'],
    [77, ' 7'],
    [82, date],
    [90, ' 0.5'],
    [94, '5.94'],
    [98, '6.44'],
  ])

describe('parseAdisFiles Milchproben', () => {
  it('liest K03 (laufende Laktation) wie K33', () => {
    const parsed = parseAdisFiles([{ name: 'b1.K03', text: [test('K03', '20260925'), test('K03', '20260828')].join('\r\n') }], 'sheep')
    expect(parsed.milkTests.map((t) => [t.test_date, t.milk_kg, t.fat_pct, t.protein_pct])).toEqual([
      ['2026-09-25', 0.5, 5.94, 6.44],
      ['2026-08-28', 0.5, 5.94, 6.44],
    ])
  })
})
