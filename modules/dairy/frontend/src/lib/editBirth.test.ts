import { describe, expect, it } from 'vitest'
import { validateBirthEdit, type EditBirth, type EditOffspring } from './editBirth'
import type { Animal } from '../types'

const animal = (ear_tag: string, extra: Partial<Animal> = {}): Animal => ({
  id: ear_tag, ear_tag, name: null, breed_code: 'LAC', birth_date: null, sex: 'w', status: 'aktiv',
  entry_date: null, exit_date: null, notes: null, updated_at: '', deleted_at: null, lauf_nr: null, ...extra,
})
const lamb = (p: Partial<EditOffspring> = {}): EditOffspring => ({ id: 'o1', ear_tag: '', sex: 'w', fate: 'lebend', birth_weight_kg: null, animalId: null, tagged: false, diedOn: null, ...p })
const birth = (offspring: EditOffspring[], p: Partial<EditBirth> = {}): EditBirth => ({
  id: 'b1', dam: animal('CH113900000901'), manual: true, birth_date: '2027-01-20', sire: { key: null, ear_tag: '', name: '' }, ease: null, notes: '', offspring, ...p,
})
const TODAY = '2027-02-01'

describe('validateBirthEdit', () => {
  const before = birth([lamb({ id: 'o1', ear_tag: 'CH113900000911', tagged: true, animalId: 'a1' })])

  it('weiteres Lamm braucht Geschlecht und Ohrmarke oder «später»', () => {
    const edit = birth([...before.offspring, lamb({ id: null, sex: null })])
    expect(validateBirthEdit(edit, before, [], [], TODAY)).toBe('Nachkomme 2: Ohrmarke fehlt – eintragen oder «später» wählen.')
    const later = birth([...before.offspring, lamb({ id: null, sex: 'm', tag_later: true })])
    expect(validateBirthEdit(later, before, [], [], TODAY)).toBeNull()
  })

  it('schon gesetzte Ohrmarke zählt nicht als doppelt im Bestand', () => {
    expect(validateBirthEdit(before, before, [animal('CH113900000911')], [], TODAY)).toBeNull()
  })

  it('neue Ohrmarke darf es im Bestand nicht geben', () => {
    const edit = birth([...before.offspring, lamb({ id: null, ear_tag: 'CH113900000922' })])
    expect(validateBirthEdit(edit, before, [animal('CH113900000922', { lauf_nr: '77' })], [], TODAY)).toMatch(/gibt es schon \(77\)/)
  })

  it('offenes Lamm ohne Ohrmarke bleibt Pendenz', () => {
    const b = birth([lamb({ id: 'o2' })])
    expect(validateBirthEdit(b, b, [], [], TODAY)).toBeNull()
  })

  it('Datum: nicht in der Zukunft, nicht auf eine andere Geburt', () => {
    expect(validateBirthEdit({ ...before, birth_date: '2027-03-01' }, before, [], [], TODAY)).toMatch(/Zukunft/)
    expect(validateBirthEdit({ ...before, birth_date: '2026-01-10' }, before, [], ['2026-01-10'], TODAY)).toMatch(/schon eine Geburt/)
  })

  it('mindestens ein Nachkomme bleibt', () => {
    const b = birth([lamb({ id: 'o2' })])
    expect(validateBirthEdit(birth([lamb({ id: 'o2', remove: true })]), b, [], [], TODAY)).toMatch(/Mindestens ein Nachkomme/)
  })
})
