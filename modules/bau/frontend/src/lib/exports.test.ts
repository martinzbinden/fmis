import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildExport, selectForExport, type ExportKind } from './exports'
import { planImport } from './importPlan'
import { parseKml } from './kml'
import { accuracyClass, lineFromPoints, nextPointNo, nextSeq, pointFromSurvey } from './survey'
import { FEATURES, POINTS } from './testData'

const input = { projectName: 'Gülleleitung Riedacker', features: FEATURES, points: POINTS, selectedIds: null, date: '2026-11-05' }

describe('Auswahl für den Export', () => {
  it('alle: verworfene fehlen (ausser ausdrücklich), alle Messpunkte', () => {
    expect(selectForExport(input).features.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(selectForExport({ ...input, includeDiscarded: true }).features).toHaveLength(4)
    expect(selectForExport(input).points).toHaveLength(2)
  })

  it('nur Auswahl: gewählte Objekte und deren Messpunkte', () => {
    const r = selectForExport({ ...input, selectedIds: new Set(['f2']) })
    expect(r.features.map((f) => f.id)).toEqual(['f2'])
    expect(r.points).toEqual([]) // Messpunkte gehören zu f1
    const r2 = selectForExport({ ...input, selectedIds: new Set(['f1', 'f4']) })
    expect(r2.features.map((f) => f.id)).toEqual(['f1', 'f4']) // verworfenes ausdrücklich gewählt
    expect(r2.points).toHaveLength(2)
  })
})

describe('buildExport', () => {
  const kinds: [ExportKind, string][] = [
    ['kml', 'kml'], ['kmz', 'kmz'], ['dxf', 'dxf'], ['geojson', 'geojson'], ['gpx', 'gpx'], ['csv', 'csv'],
  ]
  it.each(kinds)('%s: Dateiname mit Projekt und Datum', async (kind, ext) => {
    const f = await buildExport(kind, input)
    expect(f.name).toBe(`Guelleleitung_Riedacker_2026-11-05.${ext}`)
    expect(f.data.length).toBeGreaterThan(20)
  })

  it('KMZ ist ein ZIP mit der KML', async () => {
    const f = await buildExport('kmz', input)
    const zip = await JSZip.loadAsync(f.data as Uint8Array)
    expect(await zip.file('doc.kml')!.async('string')).toContain('<Style id="guelle">')
  })

  it('DXF enthält die Auswahl, nicht das Verworfene', async () => {
    const f = await buildExport('dxf', input)
    expect(String(f.data)).not.toContain('LEERROHR')
  })
})

describe('Import ergänzt nur', () => {
  const kml = `<kml><Document><Placemark><name>Gülleleitung</name><LineString><coordinates>7.399,46.787 7.400,46.788</coordinates></LineString></Placemark>
  <Placemark><name>Neu</name><Point><coordinates>7.4,46.79</coordinates></Point></Placemark></Document></kml>`

  it('überspringt Gleiches, ein zweiter Import ergibt 0 neue Objekte', () => {
    const first = planImport([], parseKml(kml))
    expect(first.toAdd).toHaveLength(2)
    const existing = first.toAdd.map((f) => ({ label: f.label, geometry: JSON.stringify(f.geometry) }))
    const second = planImport(existing, parseKml(kml))
    expect(second.toAdd).toHaveLength(0)
    expect(second.skipped).toHaveLength(2)
  })

  it('gleiche Geometrie unter anderem Namen ist ein neues Objekt; Dubletten in der Datei zählen einmal', () => {
    const dup = kml + kml
    expect(planImport([], parseKml(dup)).toAdd).toHaveLength(2)
    const renamed = [{ label: 'Anderer Name', geometry: JSON.stringify({ type: 'Point', coordinates: [7.4, 46.79] }) }]
    expect(planImport(renamed, parseKml(kml)).toAdd).toHaveLength(2)
  })
})

describe('Einmessen', () => {
  it('Genauigkeit einstufen', () => {
    expect(accuracyClass(1.2)).toBe('gut')
    expect(accuracyClass(2)).toBe('gut')
    expect(accuracyClass(4.9)).toBe('ok')
    expect(accuracyClass(5)).toBe('ok')
    expect(accuracyClass(5.1)).toBe('schlecht')
    expect(accuracyClass(null)).toBe('unbekannt')
  })

  it('Punktnummer und Reihenfolge laufen weiter', () => {
    expect(nextPointNo([])).toBe(1)
    expect(nextPointNo(POINTS)).toBe(3)
    expect(nextSeq(POINTS, 'f1')).toBe(3)
    expect(nextSeq(POINTS, 'f2')).toBe(1)
    expect(nextSeq(POINTS, null)).toBe(1)
  })

  it('Linie aus Messpunkten in Messreihenfolge; ein Punkt reicht nicht', () => {
    const g = lineFromPoints([POINTS[1], POINTS[0]])
    expect(g).toMatchObject({ type: 'LineString' })
    expect((g as { coordinates: number[][] }).coordinates[0][1]).toBeCloseTo(POINTS[0].lat, 9)
    expect(lineFromPoints([POINTS[0]])).toBeNull()
    expect(pointFromSurvey(POINTS[0])).toEqual({ type: 'Point', coordinates: [POINTS[0].lng, POINTS[0].lat] })
  })
})
