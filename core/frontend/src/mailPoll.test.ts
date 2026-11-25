import { describe, expect, it } from 'vitest'
import { pollText } from './MailSettings'

describe('pollText', () => {
  it('nennt, warum Mails übersprungen wurden', () => {
    expect(pollText({ configured: true, mails: 1, saved: 2, total: 4, known: 2, foreign: 1, unmatched: 0 })).toBe(
      'Abgerufen: 1 neue Mails, 2 Einträge (4 im Postfach: 2 schon früher verarbeitet, 1 Absender nicht erlaubt)',
    )
  })
  it('leeres Postfach und nicht eingerichtet', () => {
    expect(pollText({ configured: true, mails: 0, saved: 0, total: 0, known: 0, foreign: 0, unmatched: 0 })).toBe('Abgerufen: 0 neue Mails, 0 Einträge (0 im Postfach)')
    expect(pollText({ configured: false })).toBe('Noch nicht eingerichtet')
  })
})
