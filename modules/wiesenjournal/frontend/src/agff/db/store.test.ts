import { describe, expect, it } from 'vitest'
import { emptySnapshot, memoryPersist, SCHEMA, Store } from './store'

describe('Store', () => {
  it('erster Start: Düngerarten angelegt und dauerhaft gespeichert', async () => {
    const p = memoryPersist()
    const s = await Store.open(p)
    expect(s.rows('fertilizer_types')).toHaveLength(11)
    const again = await Store.open(p)
    expect(again.rows('fertilizer_types').map((t) => t.code)).toContain('RGv')
  })
  it('put ergänzt, softDelete blendet aus, Version zählt hoch, Vorgaben gesetzt', async () => {
    const p = memoryPersist()
    const s = await Store.open(p)
    const v0 = s.version
    s.put('parcels', { id: 'a', season_year: 2026, name: 'A' })
    s.put('parcels', { id: 'a', notes: 'x' })
    expect(s.get('parcels', 'a')).toMatchObject({ name: 'A', notes: 'x', source: 'manual', gelan_missing: false, deleted_at: null })
    s.softDelete('parcels', 'a')
    expect(s.get('parcels', 'a')).toBeNull()
    expect(s.rows('parcels')).toHaveLength(0)
    expect(s.rows('parcels', true)).toHaveLength(1)
    expect(s.version).toBe(v0 + 3)
    await s.flush()
    const neu = await Store.open(p)
    expect(neu.rows('parcels', true)[0]).toMatchObject({ notes: 'x' })
    expect(neu.rows('parcels', true)[0].deleted_at).not.toBeNull()
  })
  it('batch: eine Benachrichtigung', async () => {
    const s = await Store.open(memoryPersist())
    let n = 0
    s.subscribe(() => n++)
    s.batch(() => {
      for (let i = 0; i < 50; i++) s.put('usage_entries', { id: `u${i}`, parcel_id: 'p', entry_date: '2026-05-01' })
    })
    expect(n).toBe(1)
    expect(s.rows('usage_entries')).toHaveLength(50)
  })
  it('Einstellungen und ganzer Bestand ersetzen', async () => {
    const s = await Store.open(memoryPersist())
    s.setSetting('count_settings', { minDwellSec: 10 })
    expect(s.getSetting('count_settings', { minDwellSec: 30, minDistM: 40 })).toEqual({ minDwellSec: 10, minDistM: 40 })
    const snap = s.snapshot()
    s.put('parcels', { id: 'weg', name: 'weg', season_year: 2026 })
    await s.replaceAll(snap)
    expect(s.get('parcels', 'weg')).toBeNull()
  })
  it('Betriebseinstellungen als Zeilen mit Zeitstempel, Gerätebezogenes bleibt in settings', async () => {
    const s = await Store.open(memoryPersist())
    s.setSetting('betriebsnummer', 'CH123')
    expect(s.get('einstellungen', 'betriebsnummer')).toMatchObject({ wert: 'CH123' })
    expect(s.get('einstellungen', 'betriebsnummer')?.updated_at).toMatch(/^\d{4}-/)
    expect(s.getSetting('betriebsnummer', '')).toBe('CH123')
    expect(s.get('einstellungen', 'schema')).toBeNull()
    expect(s.snapshot().settings).toMatchObject({ schema: SCHEMA })
    expect(s.snapshot().settings.betriebsnummer).toBeUndefined()
  })
  it('Schema 3 → 4: alte Einstellungen ziehen um, «unbekannt alt», auch beim Zurückspielen', async () => {
    const alt = () => ({ ...emptySnapshot(), settings: { schema: 3, angelegt: '2026-01-01T00:00:00.000Z', betriebsnummer: 'CH9', klein_ausblenden: { an: true, grenze_a: 5 } } })
    const p = memoryPersist(alt())
    const s = await Store.open(p)
    expect(s.getSetting('schema', 0)).toBe(SCHEMA)
    expect(s.getSetting('betriebsnummer', '')).toBe('CH9')
    expect(s.get('einstellungen', 'klein_ausblenden')).toMatchObject({ wert: { an: true, grenze_a: 5 }, updated_at: '1970-01-01T00:00:00.000Z' })
    await s.flush()
    const neu = await Store.open(p) // gespeichert: nach dem Neuladen gleich, settings ohne Betriebseinstellungen
    expect(neu.getSetting('betriebsnummer', '')).toBe('CH9')
    expect(neu.snapshot().settings).toEqual({ schema: SCHEMA, angelegt: '2026-01-01T00:00:00.000Z' })
    neu.setSetting('betriebsnummer', 'CH10')
    await neu.replaceAll(alt()) // ältere Sicherung zurückspielen
    expect(neu.getSetting('betriebsnummer', '')).toBe('CH9')
  })
  it('Schreibfehler wird gemeldet, Speicher bleibt', async () => {
    const p = memoryPersist()
    const s = await Store.open(p)
    p.write = async () => {
      throw new Error('QuotaExceededError')
    }
    s.put('parcels', { id: 'q', name: 'Q', season_year: 2026 })
    await s.flush()
    expect(s.lastError).toMatch(/QuotaExceeded/)
    expect(s.get('parcels', 'q')?.name).toBe('Q')
  })
})
