import { describe, expect, it } from 'vitest'
import { parseFertalys, parseMailDate } from './fertalys'

// erfundene Namen, Aufbau wie die Mail von cownect/Qualitas
const MAIL = `cownect@example.ch <cownect@example.ch>
Mi., 26. Aug., 16:20
an mich

Sehr geehrte Damen und Herren,
Sie erhalten Ihre neuen FERTALYS Resultate. Wir danken Ihnen für den Auftrag.

TESTA Trächtig
PROBINA Nicht trächtig
MUSTER ROSA Fraglich

Vielen Dank und freundliche Grüsse`

describe('FERTALYS-Mail', () => {
  it('Resultatzeilen, Fliesstext fällt weg', () => {
    expect(parseFertalys(MAIL)).toEqual([
      { name: 'TESTA', result: 'ja', text: 'Trächtig' },
      { name: 'PROBINA', result: 'nein', text: 'Nicht trächtig' },
      { name: 'MUSTER ROSA', result: 'unsicher', text: 'Fraglich' },
    ])
  })
  it('Datum der Mail, ohne Jahr das letzte bis heute', () => {
    expect(parseMailDate(MAIL, '2026-11-24')).toBe('2026-08-26')
    expect(parseMailDate('Mi., 26. Dez., 16:20', '2026-11-24')).toBe('2025-12-26')
    expect(parseMailDate('Datum: 03.09.2026', '2026-11-24')).toBe('2026-09-03')
    expect(parseMailDate('ohne Datum', '2026-11-24')).toBeNull()
  })
})
