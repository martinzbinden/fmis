import { describe, expect, it } from 'vitest'
import { animalKey } from '@fmis/core/earTag'
import { autoListAnimals, choiceOfRow, indexChoices, isOpenChoice, rowFor, type ChoiceRow } from './breedingChoice'
import { choiceValue, type BoardCard } from './board'
import { matchesQuery, parseQuery } from './boardQuery'

const row = (p: Partial<ChoiceRow>): ChoiceRow => ({ id: crypto.randomUUID(), animal_key: null, offspring_id: null, purpose: null, leaning: null, notes: null, ...p })

describe('Zuchtauswahl', () => {
  it('nur Zucht und Mast gelten als entschieden', () => {
    expect(isOpenChoice(null)).toBe(true)
    expect(isOpenChoice('eher_ja')).toBe(true)
    expect(isOpenChoice('spaeter')).toBe(true)
    expect(isOpenChoice('eher_nein')).toBe(true)
    expect(isOpenChoice('zucht')).toBe(false)
    expect(isOpenChoice('mast')).toBe(false)
  })

  it('Entscheid geht vor Vorauswahl, neueste Zeile gewinnt', () => {
    expect(choiceOfRow({ purpose: 'mast', leaning: 'eher_ja' })).toBe('mast')
    expect(choiceOfRow({ purpose: null, leaning: 'spaeter' })).toBe('spaeter')
    const index = indexChoices([row({ offspring_id: 'o1', leaning: 'eher_ja' }), row({ offspring_id: 'o1', purpose: 'zucht' })])
    expect(choiceOfRow(rowFor(index, 'o1', null))).toBe('zucht')
  })

  it('findet die Wahl über die Ohrmarke, wenn sie in der Jungtier-Selektion getroffen wurde', () => {
    const index = indexChoices([row({ animal_key: '756000000000001', purpose: 'mast' })])
    expect(choiceOfRow(rowFor(index, 'o9', '756000000000001'))).toBe('mast')
    expect(rowFor(index, 'o9', null)).toBeNull()
  })

  it('automatische Liste: Zucht, aktiv, jung, selbst noch nicht geboren', () => {
    const animals = [
      { id: 'a', ear_tag: 'CH 1200.0001.1', status: 'aktiv', birth_date: '2026-03-01' },
      { id: 'b', ear_tag: 'CH 1200.0002.2', status: 'aktiv', birth_date: '2026-03-01' },
      { id: 'c', ear_tag: 'CH 1200.0003.3', status: 'abgang', birth_date: '2026-03-01' },
      { id: 'd', ear_tag: 'CH 1200.0004.4', status: 'aktiv', birth_date: '2023-03-01' },
      { id: 'e', ear_tag: 'CH 1200.0005.5', status: 'aktiv', birth_date: '2025-03-01' },
    ]
    const choices = new Map(animals.map((a, i) => [animalKey(a.ear_tag)!, i === 1 ? ('eher_ja' as const) : ('zucht' as const)]))
    // b nur «eher ja», c abgegangen, d zu alt, e hat selbst geboren
    expect(autoListAnimals(animals, choices, new Set(['e']), '2026-11-27').map((a) => a.id)).toEqual(['a'])
  })

  it('Dashboard: Jungtier ohne Wahl ist «offen», erwachsenes Tier ohne Wahl hat keinen Wert', () => {
    expect(choiceValue({ choice: null, lastBirth: null, ageMonths: 5 })).toBe('offen')
    expect(choiceValue({ choice: 'zucht', lastBirth: null, ageMonths: 5 })).toBe('zucht')
    expect(choiceValue({ choice: null, lastBirth: '2026-01-01', ageMonths: 30 })).toBeNull()
    expect(choiceValue({ choice: null, lastBirth: null, ageMonths: 30 })).toBeNull()
  })

  it('Dashboard-Formeln: «Zuchtlämmer», «Auswahl offen», «Zuchtauswahl = eher ja»', () => {
    const card = (choice: BoardCard['choice'], ageMonths = 4) => ({ choice, lastBirth: null, ageMonths, laufNr: null, shortTag: '', earTag: '', name: null }) as unknown as BoardCard
    const ctx = { today: '2026-11-27', groupName: () => null, listNames: () => [] }
    const hit = (q: string, c: BoardCard) => {
      const p = parseQuery(q)
      expect(p.errors).toEqual([])
      return matchesQuery(c, p, ctx)
    }
    expect(hit('Zuchtlämmer', card('zucht'))).toBe(true)
    expect(hit('Zuchtlämmer', card('eher_ja'))).toBe(false)
    expect(hit('Auswahl offen', card(null))).toBe(true)
    expect(hit('Auswahl offen', card('spaeter'))).toBe(true)
    expect(hit('Auswahl offen', card('mast'))).toBe(false)
    expect(hit('Auswahl offen', card(null, 40))).toBe(false)
    expect(hit('Zuchtauswahl = eher ja', card('eher_ja'))).toBe(true)
    expect(hit('Zuchtauswahl = eher ja', card('eher_nein'))).toBe(false)
  })
})
