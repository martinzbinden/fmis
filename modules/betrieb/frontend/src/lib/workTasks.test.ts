import { describe, expect, it } from 'vitest'
import { ACTIVITIES, activityByTitle, areaFor } from './workTasks'

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
