import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissToast, getToasts, notify, notifyError, errorText, translateDbError } from './toast'

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    getToasts().forEach((t) => dismissToast(t.id))
    vi.useRealTimers()
  })

  it('zeigt eine Meldung und blendet sie nach Ablauf aus', () => {
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'))
    notify('success', 'gespeichert A')
    expect(getToasts().map((t) => t.text)).toEqual(['gespeichert A'])
    vi.advanceTimersByTime(2700)
    expect(getToasts()).toHaveLength(0)
  })

  it('stapelt gleiche Meldungen nicht (mehrere Abfragen scheitern zugleich)', () => {
    vi.setSystemTime(new Date('2026-10-18T11:00:00Z'))
    notifyError('Fehler B')
    notifyError('Fehler B')
    expect(getToasts()).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-18T11:00:05Z'))
    notifyError('Fehler B')
    expect(getToasts()).toHaveLength(2)
  })

  it('Fehler bleiben länger stehen als Erfolge', () => {
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
    notifyError('Fehler C')
    vi.advanceTimersByTime(5000)
    expect(getToasts().some((t) => t.text === 'Fehler C')).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(getToasts().some((t) => t.text === 'Fehler C')).toBe(false)
  })

  it('errorText liest Exceptions und Unbekanntes', () => {
    expect(errorText(new Error('kaputt'))).toBe('kaputt')
    expect(errorText('x')).toBe('x')
  })

  it('übersetzt Datenbankfehler ins Deutsche', () => {
    const dup = Object.assign(new Error('duplicate key value violates unique constraint "animals_ear_tag_key"'), {
      code: '23505',
      detail: 'Key (ear_tag)=(CH90000130) already exists.',
    })
    expect(errorText(dup)).toBe('Gibt es schon: Ohrmarke «CH90000130» ist bereits erfasst.')
    expect(translateDbError('null value in column "lauf_nr" of relation "animals" violates not-null constraint')).toBe('Angabe fehlt: Laufnummer.')
    expect(translateDbError('invalid input syntax for type numeric: "1,5x"')).toBe('Ungültige Eingabe: «1,5x» ist keine Zahl.')
    expect(
      translateDbError('update or delete on table "animals" violates foreign key constraint "births_dam_id_fkey" on table "births"'),
    ).toBe('Kann nicht gelöscht werden: es hängen noch Einträge daran (Geburten).')
    expect(errorText(new TypeError('Failed to fetch'))).toBe('Keine Verbindung zum Server. Später nochmals versuchen.')
    expect(errorText(new Error('Ohrmarke fehlt'))).toBe('Ohrmarke fehlt')
    expect(errorText(undefined, 'Speichern fehlgeschlagen')).toBe('Speichern fehlgeschlagen')
  })
})
