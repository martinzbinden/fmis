import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readLastView, rememberView } from './lastView'

describe('zuletzt benutzte Ansicht', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    vi.stubGlobal('window', { dispatchEvent: () => true })
  })
  it('beim ersten Besuch gilt die Vorgabe', () => {
    expect(readLastView('m', 'gruppen', ['dashboard', 'gruppen'], 'dashboard')).toBe('dashboard')
  })
  it('merkt sich die Ansicht und ignoriert unbekannte Werte', () => {
    rememberView('m', 'gruppen', 'gruppen')
    expect(readLastView('m', 'gruppen', ['dashboard', 'gruppen'], 'dashboard')).toBe('gruppen')
    localStorage.setItem('m_last_view_gruppen', 'weg')
    expect(readLastView('m', 'gruppen', ['dashboard', 'gruppen'], 'dashboard')).toBe('dashboard')
  })
})
