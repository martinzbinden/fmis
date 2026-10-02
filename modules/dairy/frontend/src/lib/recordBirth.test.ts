import { describe, expect, it } from 'vitest'
import { compactEarTag, validateBirth, type BirthInput } from './recordBirth'
import { journalSummary, withdrawalEnd } from './journal'
import { cullingReasons, DEFAULT_THRESHOLDS } from './culling'
import { computeFertility } from './fertility'
import type { Animal } from '../types'

const animal = (ear_tag: string, extra: Partial<Animal> = {}): Animal => ({
  id: ear_tag, ear_tag, name: null, breed_code: 'LAC', birth_date: null, sex: 'w', status: 'aktiv',
  entry_date: null, exit_date: null, notes: null, updated_at: '', deleted_at: null, lauf_nr: null, ...extra,
})

const birth = (offspring: BirthInput['offspring']): BirthInput => ({
  dam: animal('CH113197110291'),
  birth_date: '2027-01-20',
  sire: { key: null, ear_tag: '', name: '' },
  ease: null,
  conception_date: null,
  parity: 7,
  notes: null,
  offspring,
})

describe('validateBirth', () => {
  it('verlangt bei lebenden Lämmern eine Ohrmarke', () => {
    expect(validateBirth(birth([{ ear_tag: '', sex: 'w', fate: 'lebend', birth_weight_kg: null }]), [])).toBe('Nachkomme 1: Ohrmarke fehlt.')
  })
  it('erlaubt tote Lämmer ohne Ohrmarke', () => {
    expect(validateBirth(birth([{ ear_tag: '', sex: null, fate: 'totgeboren', birth_weight_kg: null }]), [])).toBeNull()
  })
  it('erkennt eine Ohrmarke, die es im Bestand schon gibt — auch in der Langform', () => {
    const existing = [animal('CH113212345678', { lauf_nr: '2601' })]
    expect(validateBirth(birth([{ ear_tag: 'CH2123.4567', sex: 'w', fate: 'lebend', birth_weight_kg: null }]), existing)).toBe(
      'Ohrmarke CH2123.4567 gibt es schon (2601).',
    )
  })
  it('erkennt doppelt erfasste Ohrmarken', () => {
    const o = { ear_tag: 'CH21234567', sex: 'm' as const, fate: 'lebend' as const, birth_weight_kg: null }
    expect(validateBirth(birth([o, { ...o, ear_tag: 'ch 2123 4567' }]), [])).toBe('Ohrmarke ch 2123 4567 doppelt erfasst.')
  })
})

describe('compactEarTag', () => {
  it('entfernt Punkte und Leerzeichen', () => {
    expect(compactEarTag(' ch 2123.4567 ')).toBe('CH21234567')
  })
})

describe('Journal', () => {
  it('rechnet das Ende der Absetzfrist', () => {
    expect(withdrawalEnd('2026-10-02', 5)).toBe('2026-10-07')
    expect(withdrawalEnd('2026-10-02', 0)).toBeNull()
    expect(withdrawalEnd('2026-10-02', null)).toBeNull()
  })
  it('fasst eine Behandlung ohne Bemerkung zusammen', () => {
    expect(journalSummary({ category: 'behandlung', diagnosis: 'Mastitis', medication: 'Cobactan', dose: '10 ml' })).toBe('Mastitis – Cobactan 10 ml')
    expect(journalSummary({ category: 'brunst', diagnosis: null, medication: null, dose: null })).toBe('Brunst')
  })
  it('wird zum Grund in der Ausmerzliste', () => {
    const reasons = cullingReasons(
      {
        species: 'sheep',
        fertility: computeFertility([], [], 'sheep', '2026-10-02'),
        performance: undefined,
        currentLactationScc: [],
        breedingValues: {},
        lactationNumber: 3,
        recentOffspring: [],
        healthEvents12m: [
          { date: '2026-03-01', diagnosis: 'Mastitis' },
          { date: '2026-06-10', diagnosis: 'Moderhinke' },
        ],
      },
      DEFAULT_THRESHOLDS.sheep,
    )
    expect(reasons.map((r) => r.text)).toEqual(['2 Krankheits-/Behandlungstage in 12 Monaten (Mastitis, Moderhinke)'])
  })
})
