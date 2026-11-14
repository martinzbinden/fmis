import { describe, expect, it } from 'vitest'
import { matingsInWindow, sireCheck, sireForBirth, type MatingLite } from './sireCheck'

const m = (service_date: string, sire_key: string | null, service_to: string | null = null): MatingLite => ({ service_date, service_to, sire_key })

describe('sireCheck (Schafe, Tragzeit 150 ± 15)', () => {
  const birth = { birth_date: '2026-11-04', sire_key: 'A' }
  it('belegt: passende Belegung vom eingetragenen Vater', () => {
    expect(sireCheck(birth, [m('2026-06-07', 'A')], 'sheep')).toBe('belegt')
  })
  it('unklar ohne Belegung in der Tragzeit (Belegung ein Jahr früher zählt nicht)', () => {
    expect(sireCheck(birth, [m('2025-05-13', 'A')], 'sheep')).toBe('unklar')
    expect(sireCheck(birth, [], 'sheep')).toBe('unklar')
  })
  it('unklar, wenn die passende Belegung von einem anderen Bock stammt', () => {
    expect(sireCheck(birth, [m('2026-06-07', 'B')], 'sheep')).toBe('unklar')
  })
  it('ohne Vater nichts zu prüfen', () => {
    expect(sireCheck({ ...birth, sire_key: null }, [], 'sheep')).toBe('ohne')
  })
  it('offene Zeiträume zählen nur 60 Tage ab Beginn', () => {
    expect(sireCheck(birth, [m('2025-12-02', 'A', '2026-08-17')], 'sheep')).toBe('unklar')
    expect(matingsInWindow(birth.birth_date, [m('2026-05-01', 'A', '2026-06-01')], 'sheep')).toHaveLength(1)
  })
})

describe('Vater gewählt gilt als belegt (Regel)', () => {
  const b = { birth_date: '2026-11-04', sire_key: 'A', sire_chosen: true }
  it('an: gewählter Vater zählt auch ohne Belegung', () => {
    expect(sireCheck(b, [], 'sheep', true)).toBe('belegt')
  })
  it('aus: nur passende Belegungen zählen', () => {
    expect(sireCheck(b, [], 'sheep', false)).toBe('unklar')
  })
  it('nicht gewählt (Import, alte Vorbelegung): bleibt unklar', () => {
    expect(sireCheck({ ...b, sire_chosen: null }, [], 'sheep', true)).toBe('unklar')
  })
})

describe('sireForBirth', () => {
  it('eindeutig → Belegung, mehrere Böcke oder keine → null', () => {
    expect(sireForBirth('2026-11-04', [m('2026-06-07', 'A')], 'sheep')?.sire_key).toBe('A')
    expect(sireForBirth('2026-11-04', [m('2026-06-01', 'A'), m('2026-06-10', 'B')], 'sheep')).toBeNull()
    expect(sireForBirth('2026-11-04', [m('2025-05-13', 'A')], 'sheep')).toBeNull()
  })
  it('Rinder: 283 Tage', () => {
    expect(sireCheck({ birth_date: '2026-11-04', sire_key: 'A' }, [m('2026-01-26', 'A')], 'cattle')).toBe('belegt')
  })
})
