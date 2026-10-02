import { describe, expect, it } from 'vitest'
import { computeFertility, type MatingEvent } from './fertility'

const kb = (service_date: string): MatingEvent => ({ service_date, service_to: null, kind: 'kb', sire_key: 'S', sire_name: 'STIER' })

describe('computeFertility (Kuh)', () => {
  const births = [
    { birth_date: '2023-01-10', parity: 1, conception_date: null },
    { birth_date: '2024-01-25', parity: 2, conception_date: '2023-04-17' },
    { birth_date: '2025-03-01', parity: 3, conception_date: null },
  ]
  const matings = [
    kb('2023-03-01'), kb('2023-03-22'), kb('2023-04-17'), // 3 Besamungen bis zur Trächtigkeit
    kb('2024-04-01'), kb('2024-05-20'),                    // Zyklus 2: 2 Besamungen
    kb('2025-05-15'),                                      // laufender Zyklus
  ]
  const f = computeFertility(births, matings, 'cattle', '2025-07-01')

  it('rechnet ZKZ, Rastzeit und Güstzeit je Zyklus', () => {
    expect(f.cycles[0]).toMatchObject({ interval_days: 380, first_service_days: 50, open_days: 97, services: 3 })
    // ohne conception_date: letzte Belegung vor der nächsten Geburt
    expect(f.cycles[1]).toMatchObject({ interval_days: 401, first_service_days: 67, open_days: 116, services: 2 })
  })

  it('beschreibt den laufenden Zyklus', () => {
    expect(f.last_birth).toBe('2025-03-01')
    expect(f.days_since_birth).toBe(122)
    expect(f.services_since_birth).toBe(1)
    expect(f.expected_birth).toBe('2026-02-22')
  })

  it('mittelt über abgeschlossene Zyklen', () => {
    expect(f.mean_interval).toBe(390.5)
    expect(f.services_per_conception).toBe(2.5)
  })
})

describe('computeFertility (Schaf, Belegperioden)', () => {
  it('zählt eine Widder-Periode als eine Belegung', () => {
    const f = computeFertility(
      [{ birth_date: '2025-02-01', parity: 2, conception_date: null }],
      [{ service_date: '2025-09-01', service_to: '2025-10-15', kind: 'natursprung', sire_key: 'W', sire_name: 'SNOOPY' }],
      'sheep',
      '2025-10-20',
    )
    expect(f.services_since_birth).toBe(1)
    expect(f.expected_birth).toBe('2026-01-29')
  })

  it('kommt ohne Daten aus', () => {
    const f = computeFertility([], [], 'sheep', '2025-10-20')
    expect(f).toMatchObject({ last_birth: null, days_since_birth: null, expected_birth: null, mean_interval: null })
  })
})
