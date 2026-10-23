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

describe('Portal-Prüfung', () => {
  it('ist nach 6 Stunden fällig, nach einem Fehlversuch erst nach 30 Minuten wieder', async () => {
    const { ssoRecheckDue, SSO_RECHECK_MS, SSO_RETRY_MS } = await import('./auth')
    const now = 100 * 3600_000
    expect(ssoRecheckDue(null, null, now)).toBe(true)
    expect(ssoRecheckDue(now - SSO_RECHECK_MS + 1, null, now)).toBe(false)
    expect(ssoRecheckDue(now - SSO_RECHECK_MS, null, now)).toBe(true)
    expect(ssoRecheckDue(now - SSO_RECHECK_MS - 1, now - SSO_RETRY_MS + 1, now)).toBe(false)
    expect(ssoRecheckDue(now - SSO_RECHECK_MS - 1, now - SSO_RETRY_MS, now)).toBe(true)
  })

  it('liest die Nutzer-ID aus einem Token', async () => {
    const { jwtSub } = await import('./auth')
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    expect(jwtSub(`x.${b64({ sub: 'u-1' })}.y`)).toBe('u-1')
    expect(jwtSub('kaputt')).toBeNull()
    expect(jwtSub(null)).toBeNull()
  })
})
