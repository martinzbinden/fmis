import { describe, expect, it } from 'vitest'
import { animalRank, functionHits, moduleFunctions, norm, textRank } from './search'

describe('Suche über alles', () => {
  it('vereinfacht Umlaute und Satzzeichen', () => {
    expect(norm('Trächtigkeit / Ültraschall')).toBe('trachtigkeit ultraschall')
    expect(textRank('trachtig', 'Trächtigkeit')).toBe(1)
    expect(textRank('geburt', 'Geburt')).toBe(0)
    expect(textRank('burt', 'Geburt')).toBe(2)
    expect(textRank('kalb', 'Geburt', 'abkalbung kalben')).toBe(1)
    expect(textRank('xyz', 'Geburt')).toBeNull()
  })

  it('findet Tiere über Laufnummer, Ohrmarken-Ende und Name', () => {
    const a = { ear_tag: 'CH12345678', lauf_nr: '101', name: 'Testlinde' }
    expect(animalRank('101', a)).toBe(0)
    expect(animalRank('10', a)).toBe(1)
    expect(animalRank('5678', a)).toBe(1)
    expect(animalRank('12345678', a)).toBe(0)
    expect(animalRank('3456', a)).toBe(2)
    expect(animalRank('345', a)).toBeNull()
    expect(animalRank('testl', a)).toBe(1)
    expect(animalRank('999', a)).toBeNull()
    const b = { ...a, birth_date: '2021-03-12' }
    expect(animalRank('12.3.2021', b)).toBe(1)
    expect(animalRank('testl 3.2021', b)).toBe(1)
    expect(animalRank('101 12.3.', b)).toBe(0)
    expect(animalRank('13.3.', b)).toBeNull()
  })

  it('leitet Funktionen aus Fussleiste und Seitentiteln ab, eigene Liste geht vor', () => {
    const m = {
      key: 'x',
      title: 'Modul X',
      icon: '🐑',
      navItems: [{ to: '', label: 'Heute', icon: '🏠' }],
      pageTitles: { 'tiere/:id': 'Tier', geburt: 'Geburt' },
      functions: [{ to: 'geburt', label: 'Geburt', icon: '🐣', keywords: 'ablammung' }],
    }
    expect(moduleFunctions(m).map((f) => f.to)).toEqual(['geburt', ''])
    const hits = functionHits([m], 'ablammung')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ to: '/x/geburt', icon: '🐣', group: 'funktionen' })
    // nur der Modulname passt: alle Seiten, aber weiter unten
    expect(functionHits([m], 'modul x').every((h) => h.rank === 3)).toBe(true)
  })
})
