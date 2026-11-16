import { describe, expect, it } from 'vitest'
import { emptySnapshot, memoryPersist, SCHEMA, Store } from '../db/store'
import { ausnahmenAm, ausnahmeSpeichern, laufhofSetzen, laufhofZelle, weideKategorien } from './laufhof'
import type { UsageEntry } from '../types'

describe('Laufhof', () => {
  it('Schema-Schritt 1 → 2: Häkchen true wird L, sonst auto (null); auch für alte Sicherungen', async () => {
    const alt = emptySnapshot()
    alt.settings = { schema: 1 }
    alt.daily_farm_log = [
      { id: 'a', entry_date: '2026-04-01', laufhof_kuehe: true, laufhof_rinder: false, updated_at: '2026-04-01T08:00:00Z', deleted_at: null },
      { id: 'b', entry_date: '2026-04-02', laufhof_kuehe: null, updated_at: '2026-04-02T08:00:00Z', deleted_at: null },
    ] as never
    const s = await Store.open(memoryPersist(alt))
    expect(s.getSetting('schema', 0)).toBe(SCHEMA)
    expect(s.get('daily_farm_log', 'a')).toMatchObject({ laufhof_kuehe: 'L', laufhof_rinder: null, updated_at: '2026-04-01T08:00:00Z' })
    expect(s.get('daily_farm_log', 'b')?.laufhof_kuehe).toBeNull()
    // zurückgespielte alte Sicherung wird ebenfalls umgebaut
    const neu = await Store.open(memoryPersist())
    await neu.replaceAll(alt)
    expect(neu.get('daily_farm_log', 'a')?.laufhof_kuehe).toBe('L')
    // zweiter Lauf ändert nichts mehr
    const v = neu.version
    neu.migrieren()
    expect(neu.version).toBe(v)
  })

  it('auto = X bei Weide, sonst leer; von Hand gesetzt gewinnt', () => {
    const u = [
      { usage_type: 'weide', animal_category: 'kuehe', entry_date: '2026-05-01' },
      { usage_type: 'silage', animal_category: null, entry_date: '2026-05-01' },
      { usage_type: 'weide', animal_category: 'schafe', entry_date: '2026-05-02' },
    ] as UsageEntry[]
    const w = weideKategorien(u)
    expect([...(w.get('2026-05-01') ?? [])]).toEqual(['kuehe'])
    expect(laufhofZelle(null, true, [])).toEqual({ zeichen: 'X', auto: true, ausnahmen: [] })
    expect(laufhofZelle(null, false, []).zeichen).toBe('')
    expect(laufhofZelle('0', true, [])).toEqual({ zeichen: '0', auto: false, ausnahmen: [] })
    expect(laufhofZelle('L', false, []).zeichen).toBe('L')
  })

  it('setzen legt die Tagesmeldung an; Ausnahmen über Zeiträume', async () => {
    const s = await Store.open(memoryPersist())
    laufhofSetzen(s, '2026-05-03', 'rinder', 'L')
    laufhofSetzen(s, '2026-05-03', 'kuehe', '0')
    const logs = s.rows('daily_farm_log')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ laufhof_rinder: 'L', laufhof_kuehe: '0' })
    ausnahmeSpeichern(s, { kategorie: 'kuehe', grund: 'krankheit', freitext: 'Klauen', anzahl: null, tier: 'Bella', von: '2026-05-05', bis: '2026-05-02' })
    const a = s.rows('auslauf_ausnahmen')
    expect(a[0]).toMatchObject({ von: '2026-05-02', bis: '2026-05-05' }) // vertauscht korrigiert
    expect(ausnahmenAm(a, '2026-05-04', 'kuehe')).toHaveLength(1)
    expect(ausnahmenAm(a, '2026-05-06', 'kuehe')).toHaveLength(0)
    expect(ausnahmenAm(a, '2026-05-04', 'rinder')).toHaveLength(0)
  })
})
