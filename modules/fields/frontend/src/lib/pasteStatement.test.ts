import { describe, expect, it } from 'vitest'
import { checkStatement } from './pasteStatement'

const farms = [{ id: 'f1', name: 'Hof A' }]
const row = (over = {}) => ({ betrieb: 'Hof A', jahr: 2025, abschnitt: 'lq', bezeichnung: 'Wald-Vorland', zone: '51', anzahl: 100, ansatz: 1.55, faktor: 0.73, betrag: 113.15, ...over })

describe('checkStatement', () => {
  it('übernimmt eine gültige Zeile', () => {
    const [r] = checkStatement([row()], farms, [])
    expect(r.status).toBe('neu')
    expect(r.value).toMatchObject({ farm_id: 'f1', jahr: 2025, section: 'lq', amount: 113.15 })
  })

  it('meldet unbekannten Betrieb, Abschnitt und fehlenden Betrag', () => {
    expect(checkStatement([row({ betrieb: 'X' })], farms, [])[0].status).toBe('fehler')
    expect(checkStatement([row({ abschnitt: 'foo' })], farms, [])[0].status).toBe('fehler')
    expect(checkStatement([row({ betrag: null })], farms, [])[0].status).toBe('fehler')
  })

  it('erkennt Doppelte, auch im selben Block', () => {
    expect(checkStatement([row()], farms, [{ farm_id: 'f1', jahr: 2025, section: 'lq', label: 'Wald-Vorland', zone: '51' }])[0].status).toBe('doppelt')
    expect(checkStatement([row(), row()], farms, [])[1].status).toBe('doppelt')
    expect(checkStatement([row(), row({ zone: '52' })], farms, [])[1].status).toBe('neu')
  })
})
