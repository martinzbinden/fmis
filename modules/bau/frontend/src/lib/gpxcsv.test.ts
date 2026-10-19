import { describe, expect, it } from 'vitest'
import { buildGpx } from './gpx'
import { buildSurveyCsv, pointLabel, SURVEY_CSV_HEADER } from './csv'
import { csvField, exportFileName, safeName } from './text'
import { FEATURES, POINTS } from './testData'

describe('GPX', () => {
  const gpx = buildGpx('Test & Co', FEATURES, POINTS)
  it('Leitungen als Tracks, Punkte und Messpunkte als Wegpunkte', () => {
    expect(gpx).toContain('<gpx version="1.1"')
    expect((gpx.match(/<trk>/g) ?? []).length).toBe(3) // Leitung, Fläche, verworfene Leitung (Auswahl erfolgt vorher)
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(3 + 5 + 2)
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(1 + 2) // Schacht + 2 Messpunkte
    expect(gpx).toContain('<name>P001</name>')
    expect(gpx).toContain('<ele>523.5</ele>')
    expect(gpx).toContain('Test &amp; Co')
  })
})

describe('CSV Messpunkte', () => {
  const csv = buildSurveyCsv([POINTS[1], POINTS[0]], FEATURES)
  const rows = csv.replace('﻿', '').trim().split('\r\n')

  it('Kopfzeile, UTF-8-BOM, sortiert nach Punktnummer', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(rows[0]).toBe(SURVEY_CSV_HEADER.join(';'))
    expect(rows[1].startsWith('P001;Gülleleitung;')).toBe(true)
    expect(rows[2].startsWith('P002;')).toBe(true)
  })

  it('E/N in LV95 mit 2 Stellen, Höhe, Tiefe, Genauigkeit, Datum', () => {
    const c = rows[1].split(';')
    expect(Number(c[2])).toBeCloseTo(2597010, 1)
    expect(Number(c[3])).toBeCloseTo(1182001, 1)
    // 08:15:30 UTC = 09:15:30 Schweizer Zeit (Winterzeit)
    expect(c.slice(4, 9)).toEqual(['523.5', '110', '1.4', '2026-11-05 09:15:30', 'martin@x.ch'])
  })

  it('Notiz mit Semikolon/Anführungszeichen wird maskiert; leere Felder bleiben leer', () => {
    expect(rows[1]).toContain('"Anfang; ""Bogen"""')
    expect(rows[2].split(';').slice(4, 7)).toEqual(['', '', ''])
  })

  it('Hilfsfunktionen', () => {
    expect(pointLabel(7)).toBe('P007')
    expect(csvField(null)).toBe('')
    expect(csvField('a;b')).toBe('"a;b"')
  })
})

describe('Dateinamen', () => {
  it('Projektname und Datum, Umlaute ausgeschrieben', () => {
    expect(exportFileName('Gülleleitung Riedacker', 'dxf', '2026-11-05')).toBe('Guelleleitung_Riedacker_2026-11-05.dxf')
    expect(safeName('///')).toBe('Projekt')
    expect(safeName('Zürich Süd')).toBe('Zuerich_Sued')
  })
})
