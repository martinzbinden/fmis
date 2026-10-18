import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('cachedMe', () => {
  it('liefert die zuletzt gespeicherten Rechte', async () => {
    const { cachedMe } = await import('./auth')
    store.set('fmis_me', JSON.stringify({ email: 'a@b.ch', role: 'Admin', permissions: ['betrieb:tracking:write'] }))
    expect(cachedMe()).toEqual({ email: 'a@b.ch', role: 'Admin', permissions: ['betrieb:tracking:write'] })
  })

  it('ignoriert fehlenden oder beschädigten Speicher', async () => {
    const { cachedMe } = await import('./auth')
    expect(cachedMe()).toBeNull()
    store.set('fmis_me', '{kaputt')
    expect(cachedMe()).toBeNull()
    store.set('fmis_me', JSON.stringify({ email: 'a@b.ch', permissions: 'alle' }))
    expect(cachedMe()).toBeNull()
  })

  it('Abmelden entfernt die Rechte', async () => {
    const { cachedMe, logout } = await import('./auth')
    store.set('fmis_me', JSON.stringify({ email: 'a@b.ch', role: null, permissions: [] }))
    logout()
    expect(cachedMe()).toBeNull()
  })
})
