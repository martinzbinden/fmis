import { describe, expect, it } from 'vitest'
import { SYNC_TABLES } from './tables'

// Der Abgleich schreibt die Tabellen in dieser Reihenfolge, die Verweise (Fremdschlüssel) werden sofort
// geprüft: Wer auf eine andere Tabelle zeigt, muss danach kommen. Sonst bricht der Abgleich auf einem
// frischen Gerät ab («violates foreign key constraint»).
describe('SYNC_TABLES: Reihenfolge nach Fremdschlüsseln', () => {
  const order = Object.keys(SYNC_TABLES)
  const before = (a: string, b: string) => expect(order.indexOf(a), `${a} vor ${b}`).toBeLessThan(order.indexOf(b))

  it('Geburt und Nachkomme vor Journal, Absetzen und Gewichten', () => {
    before('births', 'birth_offspring')
    before('birth_offspring', 'animal_journal')
    before('birth_offspring', 'weanings')
    before('birth_offspring', 'animal_weights')
    before('birth_offspring', 'stall_decisions')
    before('animals', 'stall_decisions')
    before('animals', 'culling_marks')
  })

  it('Journal vor seinen Fotos', () => {
    before('animal_journal', 'journal_photos')
  })
})
