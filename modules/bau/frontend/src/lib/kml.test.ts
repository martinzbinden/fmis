import { describe, expect, it } from 'vitest'
import { buildKml, parseKml } from './kml'
import { buildKmz } from './kmz'
import { FEATURES, POINTS } from './testData'
import { parseGeometry } from './geometry'
import JSZip from 'jszip'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Test</name>
<Placemark><name>Gülleleitung + Leerrohr</name><description><![CDATA[Bau <b>November</b> &amp; fertig]]></description>
<LineString><coordinates>7.399,46.787,0 7.400,46.788,0 7.401,46.788,0</coordinates></LineString></Placemark>
<Placemark><name>Drainageschacht</name><Point><coordinates>7.4005,46.7885,0</coordinates></Point></Placemark>
<Placemark><name>Gebäude R. Burri</name><Polygon><outerBoundaryIs><LinearRing><coordinates>7.40,46.78,0 7.41,46.78,0 7.41,46.79,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Zwei Teile</name><MultiGeometry><LineString><coordinates>7.1,46.1 7.2,46.2</coordinates></LineString><LineString><coordinates>7.3,46.3 7.4,46.4</coordinates></LineString></MultiGeometry></Placemark>
<Placemark><name>Nur Beschriftung</name></Placemark>
</Document></kml>`

describe('KML lesen', () => {
  const out = parseKml(SAMPLE)

  it('liest Linie, Punkt, Fläche und mehrteilige Objekte', () => {
    expect(out.map((f) => [f.label, f.geometry.type])).toEqual([
      ['Gülleleitung + Leerrohr', 'LineString'],
      ['Drainageschacht', 'Point'],
      ['Gebäude R. Burri', 'Polygon'],
      ['Zwei Teile (1)', 'LineString'],
      ['Zwei Teile (2)', 'LineString'],
    ])
  })

  it('CDATA, Entitäten und HTML in der Beschreibung', () => {
    expect(out[0].description).toBe('Bau November & fertig')
  })

  it('erkennt die Kategorie aus dem Namen', () => {
    expect(out.map((f) => f.category)).toEqual(['guelle', 'drainage', 'gebaeude', 'sonstiges', 'sonstiges'])
  })

  it('schliesst offene Flächenringe', () => {
    const ring = (out[2].geometry as { coordinates: number[][][] }).coordinates[0]
    expect(ring).toHaveLength(4)
    expect(ring[0]).toEqual(ring[3])
  })

  it('leere oder fremde Dateien ergeben keine Objekte', () => {
    expect(parseKml('')).toEqual([])
    expect(parseKml('<html></html>')).toEqual([])
  })
})

describe('KML schreiben', () => {
  const kml = buildKml('Gülle & Co <1>', FEATURES, POINTS)

  it('ist gültiges XML-Gerüst mit Stil je benutzter Kategorie', () => {
    expect(kml.startsWith('<?xml')).toBe(true)
    expect(kml).toContain('<name>Gülle &amp; Co &lt;1&gt;</name>')
    expect(kml).toContain('<Style id="guelle">')
    expect(kml).toContain('<Style id="schacht">')
    expect(kml).not.toContain('<Style id="strom">')
    // Gülle #92400e → KML aabbggrr = ff003e92... (b=0e g=40 r=92)
    expect(kml).toContain('<color>ff0e4092</color>')
  })

  it('schreibt Attribute in die Beschreibung und maskiert Sonderzeichen', () => {
    expect(kml).toContain('Material: PE 100 ND16')
    expect(kml).toContain('Durchmesser: 90 mm')
    expect(kml).toContain('Verlegetiefe: 120 cm')
    expect(kml).toContain('Länge: 150.0 m')
    expect(kml).toContain('Einpflügen &amp; &quot;Test&quot; &lt;1&gt;')
  })

  it('Rundreise: Geometrien und Namen bleiben erhalten (ohne Messpunkte-Ordner)', () => {
    const back = parseKml(buildKml('x', FEATURES))
    expect(back.map((f) => f.label)).toEqual(['Gülleleitung', 'Schacht 1', 'Hof', 'Alt'])
    const g0 = parseGeometry(FEATURES[0].geometry) as { coordinates: number[][] }
    const b0 = back[0].geometry as { coordinates: number[][] }
    expect(b0.coordinates[1][0]).toBeCloseTo(g0.coordinates[1][0], 6)
    expect(b0.coordinates[1][1]).toBeCloseTo(g0.coordinates[1][1], 6)
  })

  it('Messpunkte als Ordner mit Punktnummer', () => {
    expect(kml).toContain('<Folder><name>Messpunkte</name>')
    expect(kml).toContain('<name>P001</name>')
    expect(kml).toContain('Genauigkeit: ±1.4 m')
  })

  it('KMZ enthält doc.kml', async () => {
    const zip = await JSZip.loadAsync(await buildKmz(kml))
    expect(Object.keys(zip.files)).toEqual(['doc.kml'])
    expect(await zip.file('doc.kml')!.async('string')).toBe(kml)
  })
})
