import { describe, expect, it } from 'vitest'
import { kuerzbar, kuerzen, kurzVorschlaege, umbenennen } from './kurzname'
import type { Parcel } from '../types'

const p = (id: string, name: string, area_a: number | null = 10, name_import: string | null = null) => ({ id, name, area_a, name_import }) as Parcel

describe('Kurznamen', () => {
  it('kürzt Kulturnamen aus geodienste.ch und GELAN, ohne Fläche', () => {
    expect(kuerzen('Extensiv genutzte Wiesen 13 a')).toBe('Ext. Wiese')
    expect(kuerzen('Wenig intensiv genutzte Wiesen 7 a')).toBe('Wenig int. Wiese')
    expect(kuerzen('Übrige Dauerwiesen 440 a')).toBe('Dauerwiese')
    expect(kuerzen('Kunstwiesen 189 a')).toBe('Kunstwiese')
    expect(kuerzen('Winterraps zur Speiseölgewinnung 120 a')).toBe('Winterraps')
    expect(kuerzen('Hecken-, Feld- und Ufergehölze 4 a')).toBe('Hecke')
    expect(kuerzen('Silo- und Grünmais 80 a')).toBe('Silomais')
    expect(kuerzen('Übrige offene Ackerfläche, beitragsberechtigt 12 a')).toBe('Offene Ackerfläche')
    expect(kuerzen('Zuckerrüben 210 a')).toBe('Zuckerrübe')
    expect(kuerzen('Wintergerste 2.5 a')).toBe('Wintergerste')
  })
  it('nur Namen mit Fläche oder zu lange; eigene Namen nie', () => {
    expect(kuerzbar(p('a', 'Hausmatte'))).toBe(false)
    expect(kuerzbar(p('a', 'Kunstwiesen 12 a'))).toBe(true)
    expect(kuerzbar(p('a', 'Ein sehr langer Flurname am Bach'))).toBe(true)
    expect(kuerzbar(p('a', 'Ext. Wiese 1', 10, 'Extensiv genutzte Wiesen 13 a'))).toBe(false)
  })
  it('gleiche Kurzformen nummeriert nach Fläche, vorhandene Namen nicht doppelt', () => {
    const v = kurzVorschlaege([
      p('k', 'Extensiv genutzte Wiesen 13 a', 13),
      p('g', 'Extensiv genutzte Wiesen 49 a', 49),
      p('x', 'Kunstwiesen 189 a', 189),
      p('h', 'Kunstwiese'), // gibt es schon
    ])
    const m = Object.fromEntries(v.map((x) => [x.parcel.id, x.vorschlag]))
    expect(m).toEqual({ g: 'Ext. Wiese 1', k: 'Ext. Wiese 2', x: 'Kunstwiese 1' })
  })
  it('umbenennen behält das Original; leer oder Original: zurück', () => {
    const a = p('a', 'Kunstwiesen 12 a')
    const b = { ...a, ...umbenennen(a, 'Kunstwiese Bach') }
    expect(b).toMatchObject({ name: 'Kunstwiese Bach', name_import: 'Kunstwiesen 12 a' })
    expect(umbenennen(b, 'Neu')).toMatchObject({ name: 'Neu', name_import: 'Kunstwiesen 12 a' })
    expect(umbenennen(b, '')).toEqual({ id: 'a', name: 'Kunstwiesen 12 a', name_import: null })
    expect(umbenennen(b, 'Kunstwiesen 12 a')).toMatchObject({ name_import: null })
  })
})
