import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureInfo, captureNavItem, CAPTURE_PATHS, readLastCapture, writeLastCapture } from './lastCapture'

describe('last used capture function', () => {
  beforeEach(() => {
    // Testumgebung ohne Browser: kleiner Speicher und das Ereignis der Fussleiste
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    vi.stubGlobal('window', { dispatchEvent: () => true })
  })

  it('defaults to the birth entry, with species-specific names', () => {
    expect(readLastCapture('dairy_schafe')).toBe('geburt')
    expect(captureNavItem('dairy_schafe', true)).toMatchObject({ to: 'geburt', label: 'Ablammung' })
    expect(captureNavItem('dairy', false)).toMatchObject({ to: 'geburt', label: 'Abkalbung' })
  })

  it('remembers the last one per module and shows it in the bar', () => {
    writeLastCapture('dairy_schafe', 'klauen')
    expect(captureNavItem('dairy_schafe', true)).toMatchObject({ to: 'klauen', label: 'Klauen' })
    expect(readLastCapture('dairy')).toBe('geburt')
  })

  it('ignores paths that are not capture functions, and has a label for each one', () => {
    writeLastCapture('dairy_schafe', 'tiere')
    expect(readLastCapture('dairy_schafe')).toBe('geburt')
    for (const p of CAPTURE_PATHS) expect(captureInfo(p, true)).not.toBeNull()
  })

  it('the item is active on every capture page', () => {
    expect(captureNavItem('dairy_schafe', true).also).toEqual(CAPTURE_PATHS)
  })
})
