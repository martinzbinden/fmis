import { describe, expect, it } from 'vitest'
import { textRank } from '@fmis/core/search'
import { captureFunctions } from './menuItems'

const find = (q: string, sheep = false) => captureFunctions(sheep).filter((f) => textRank(q, f.label, f.keywords) != null).map((f) => f.to)

describe('Suche über alles: Erfassungsarten und Methoden', () => {
  it('findet Methoden und Arten', () => {
    expect(find('fertalys')).toContain('traechtigkeit?fertalys=1')
    expect(find('Touchieren')).toContain('traechtigkeit?methode=rektal')
    expect(find('brunst')).toContain('journal?art=brunst')
    expect(find('medikament')).toContain('journal?art=behandlung')
    expect(find('trockenstellen')).toContain('journal?art=trocken')
  })
  it('FERTALYS und Touchieren nur beim Rindvieh', () => {
    expect(find('fertalys', true)).toEqual([])
    expect(find('touchieren', true)).toEqual([])
  })
})

describe('keine Überschneidung mit «Mehr»', () => {
  it('eigene Adressen (die Suche führt je Adresse nur einen Eintrag)', async () => {
    const { menuItems } = await import('./menuItems')
    const menu = new Set(menuItems(false, 40).map((m) => m.to))
    expect(captureFunctions(false).filter((f) => menu.has(f.to))).toEqual([])
  })
})
