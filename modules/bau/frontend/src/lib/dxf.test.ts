import { describe, expect, it } from 'vitest'
import { buildDxf, dxfText, midpointOf } from './dxf'
import { FEATURES, POINTS } from './testData'
import { wgs84ToLv95 } from '@fmis/core/lv95'
import { parseGeometry } from './geometry'

interface Tag { code: number; value: string }

/** Zerlegt eine DXF-Datei in (Gruppencode, Wert)-Paare und prüft das Gerüst. */
function tags(dxf: string): Tag[] {
  const lines = dxf.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  expect(lines.length % 2).toBe(0)
  const out: Tag[] = []
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim())
    expect(Number.isInteger(code)).toBe(true)
    out.push({ code, value: lines[i + 1] })
  }
  return out
}

/** Entities als Liste: {type, tags[]} aus der ENTITIES-Section. */
function entities(t: Tag[]) {
  const start = t.findIndex((x, i) => x.code === 2 && x.value === 'ENTITIES' && t[i - 1].value === 'SECTION')
  const end = t.findIndex((x, i) => i > start && x.code === 0 && x.value === 'ENDSEC')
  const out: { type: string; tags: Tag[] }[] = []
  for (const x of t.slice(start + 1, end)) {
    if (x.code === 0) out.push({ type: x.value, tags: [] })
    else out[out.length - 1].tags.push(x)
  }
  return out
}
const val = (tg: Tag[], code: number) => tg.find((x) => x.code === code)?.value
const all = (tg: Tag[], code: number) => tg.filter((x) => x.code === code).map((x) => x.value)

describe('DXF R2000', () => {
  const dxf = buildDxf(FEATURES.filter((f) => f.status !== 'verworfen'), POINTS)
  const t = tags(dxf)

  it('Gerüst: Header AC1015, Sections in der richtigen Reihenfolge, EOF', () => {
    expect(val(t.slice(0, 12), 1)).toBe('AC1015')
    const sections = t.filter((x, i) => x.code === 2 && t[i - 1]?.value === 'SECTION').map((x) => x.value)
    expect(sections).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS'])
    expect(t[t.length - 1]).toEqual({ code: 0, value: 'EOF' })
    expect(dxf.includes('\r\n')).toBe(true)
  })

  it('reines ASCII (Umlaute als \\U+XXXX)', () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(dxf)).toBe(true)
    expect(dxf).toContain('G\\U+00FCllelei')
    expect(dxfText('Hof Süd\nZeile 2')).toBe('Hof S\\U+00FCd Zeile 2')
  })

  it('Handles sind eindeutig, und HANDSEED liegt darüber', () => {
    // (der Wert von $HANDSEED im Header trägt selbst den Gruppencode 5 → erst ab TABLES)
    const body = t.slice(t.findIndex((x) => x.value === 'TABLES'))
    const handles = body.filter((x) => x.code === 5).map((x) => parseInt(x.value, 16))
    expect(new Set(handles).size).toBe(handles.length)
    const seed = parseInt(t[t.findIndex((x) => x.value === '$HANDSEED') + 1].value, 16)
    expect(seed).toBeGreaterThan(Math.max(...handles))
    // alle Besitzer-Handles (330) ausser 0 existieren
    const owners = t.filter((x) => x.code === 330 && x.value !== '0').map((x) => x.value)
    const have = new Set(body.filter((x) => x.code === 5).map((x) => x.value))
    for (const o of owners) expect(have.has(o)).toBe(true)
  })

  it('Layer je Kategorie sind deklariert; jede Entity nutzt einen deklarierten Layer', () => {
    const declared = new Set<string>()
    for (let i = 0; i < t.length; i++) if (t[i].code === 0 && t[i].value === 'LAYER') declared.add(t.slice(i, i + 10).find((x) => x.code === 2)!.value)
    for (const l of ['0', 'GUELLE', 'SCHACHT', 'GEBAEUDE', 'MESSPUNKTE', 'BESCHRIFTUNG']) expect(declared.has(l)).toBe(true)
    expect(declared.has('LEERROHR')).toBe(false) // nur die verworfene Leitung → nicht exportiert
    for (const e of entities(t)) expect(declared.has(val(e.tags, 8)!)).toBe(true)
  })

  it('Leitung: LWPOLYLINE in LV95-Metern mit richtiger Eckenzahl', () => {
    const poly = entities(t).filter((e) => e.type === 'LWPOLYLINE')
    expect(poly).toHaveLength(2) // Leitung + Gebäude
    const line = poly.find((e) => val(e.tags, 8) === 'GUELLE')!
    expect(val(line.tags, 90)).toBe('3')
    expect(val(line.tags, 70)).toBe('0')
    const xs = all(line.tags, 10).map(Number)
    const ys = all(line.tags, 20).map(Number)
    expect(xs).toHaveLength(3)
    expect(xs[0]).toBeCloseTo(2597000, 2)
    expect(ys[0]).toBeCloseTo(1182000, 2)
    expect(xs[1] - xs[0]).toBeCloseTo(100, 2)
    expect(ys[2] - ys[1]).toBeCloseTo(50, 2)
  })

  it('Fläche: geschlossen (Flag 1), Schlusspunkt nicht doppelt', () => {
    const poly = entities(t).find((e) => e.type === 'LWPOLYLINE' && val(e.tags, 8) === 'GEBAEUDE')!
    expect(val(poly.tags, 70)).toBe('1')
    expect(val(poly.tags, 90)).toBe('4')
    expect(all(poly.tags, 10)).toHaveLength(4)
  })

  it('Punkte: POINT mit Koordinaten, Messpunkte mit GPS-Höhe, Beschriftung als TEXT', () => {
    const points = entities(t).filter((e) => e.type === 'POINT')
    expect(points).toHaveLength(1 + 2)
    const mp = points.filter((e) => val(e.tags, 8) === 'MESSPUNKTE')
    expect(Number(val(mp[0].tags, 30))).toBeCloseTo(523.46, 2)
    expect(Number(val(mp[1].tags, 30))).toBe(0) // ohne Höhe
    const [e, n] = wgs84ToLv95(parseGeometry(FEATURES[1].geometry)!.coordinates as [number, number])
    const schacht = points.find((x) => val(x.tags, 8) === 'SCHACHT')!
    expect(Number(val(schacht.tags, 10))).toBeCloseTo(e, 2)
    expect(Number(val(schacht.tags, 20))).toBeCloseTo(n, 2)
    const texts = entities(t).filter((x) => x.type === 'TEXT').map((x) => val(x.tags, 1))
    expect(texts).toContain('P001 H523.5')
    expect(texts).toContain('P002')
    expect(texts).toContain('Schacht 1')
    expect(texts).toContain('G\\U+00FCllelei' + 'tung d90')
  })

  it('Leitungsbeschriftung in der Linienmitte, parallel zur Linie', () => {
    const label = entities(t).find((e) => e.type === 'TEXT' && val(e.tags, 1) === 'G\\U+00FCllelei' + 'tung d90')!
    // Mitte der 150-m-Linie (100 m Ost, dann 50 m Nord) liegt bei 75 m auf dem ersten Stück: Winkel 0°
    expect(Number(val(label.tags, 50))).toBeCloseTo(0, 2)
    expect(Number(val(label.tags, 10))).toBeCloseTo(2597075, 1)
    expect(midpointOf([[0, 0], [10, 0], [10, 100]]).y).toBeCloseTo(45, 6) // 110 m lang → Mitte bei 55 m = 10 + 45
    expect(midpointOf([[0, 0], [-10, 0]]).angle).toBeCloseTo(0, 6) // nie kopfüber
  })

  it('Layer pro Status (optional)', () => {
    const d = buildDxf(FEATURES.filter((f) => f.status !== 'verworfen'), [], { statusLayers: true })
    expect(d).toContain('GUELLE_GEPLANT')
    expect(d).toContain('SCHACHT_EINGEMESSEN')
    expect(d).not.toContain('MESSPUNKTE')
  })

  it('leeres Projekt ergibt trotzdem eine gültige Datei', () => {
    const e = tags(buildDxf([], []))
    expect(e[e.length - 1].value).toBe('EOF')
    expect(entities(e)).toEqual([])
  })
})
