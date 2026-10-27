// KML lesen und schreiben (WGS84). Der Leser ist bewusst ein kleiner,
// DOM-freier Parser für die üblichen Placemark-Dateien (map.geo.admin.ch,
// Google Earth, Handy-Apps): Point, LineString, Polygon (äusserer Ring) und
// MultiGeometry (je Teil ein Objekt).

import { CATEGORIES, CATEGORY_ORDER, FEATURE_STATUS_LABEL, guessCategory } from './categories'
import { lengthM, normalizeGeometry, parseGeometry, type Geom } from './geometry'
import { escapeXml, unescapeXml } from './text'
import type { BauFeature, FeatureCategory, SurveyPoint } from '../types'
import type { LngLat } from '@fmis/core/lv95'

export interface ImportedFeature {
  label: string
  description: string
  geometry: Geom
  category: FeatureCategory
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)
  return m ? unescapeXml(m[1]).trim() : null
}

function parseCoords(text: string): LngLat[] {
  return text
    .trim()
    .split(/\s+/)
    .map((c) => c.split(',').map(Number))
    .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p) => [p[0], p[1]] as LngLat)
}

function geometriesOf(xml: string): Geom[] {
  const out: Geom[] = []
  for (const m of xml.matchAll(/<Point(?:\s[^>]*)?>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/gi)) {
    const c = parseCoords(m[1])
    if (c.length >= 1) out.push({ type: 'Point', coordinates: c[0] })
  }
  for (const m of xml.matchAll(/<LineString(?:\s[^>]*)?>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/gi)) {
    const g = normalizeGeometry({ type: 'LineString', coordinates: parseCoords(m[1]) })
    if (g) out.push(g)
  }
  for (const m of xml.matchAll(/<Polygon(?:\s[^>]*)?>[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/outerBoundaryIs>[\s\S]*?<\/Polygon>/gi)) {
    const ring = parseCoords(m[1])
    if (ring.length >= 3 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0])
    const g = normalizeGeometry({ type: 'Polygon', coordinates: [ring] })
    if (g) out.push(g)
  }
  return out
}

/** Placemarks einlesen. Mehrteilige Objekte werden zu mehreren Einträgen. */
export function parseKml(text: string): ImportedFeature[] {
  const out: ImportedFeature[] = []
  for (const m of text.matchAll(/<Placemark(?:\s[^>]*)?>([\s\S]*?)<\/Placemark>/gi)) {
    const body = m[1]
    const name = tag(body, 'name') ?? 'Ohne Namen'
    const description = (tag(body, 'description') ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const geoms = geometriesOf(body)
    geoms.forEach((geometry, i) => {
      out.push({
        label: geoms.length > 1 ? `${name} (${i + 1})` : name,
        description,
        geometry,
        category: guessCategory(name, description),
      })
    })
  }
  return out
}

// ---------------------------------------------------------------- Schreiben

/** KML-Farbe aabbggrr aus #rrggbb */
const kmlColor = (hex: string, alpha = 'ff') => `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`

const coordsText = (cs: LngLat[]) => cs.map((c) => `${c[0].toFixed(7)},${c[1].toFixed(7)},0`).join(' ')

function geometryKml(g: Geom): string {
  if (g.type === 'Point') return `<Point><coordinates>${coordsText([g.coordinates])}</coordinates></Point>`
  if (g.type === 'LineString') return `<LineString><tessellate>1</tessellate><coordinates>${coordsText(g.coordinates)}</coordinates></LineString>`
  return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsText(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
}

function featureDescription(f: BauFeature, g: Geom | null): string {
  const rows: [string, string | null][] = [
    ['Kategorie', CATEGORIES[f.category].label],
    ['Status', FEATURE_STATUS_LABEL[f.status]],
    ['Material', f.material],
    ['Durchmesser', f.diameter_mm != null ? `${f.diameter_mm} mm` : null],
    ['Verlegetiefe', f.depth_cm != null ? `${f.depth_cm} cm` : null],
    ['Länge', lengthM(g) != null ? `${lengthM(g)!.toFixed(1)} m` : null],
    ['Notiz', f.notes],
  ]
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
}

/** KML eines Projekts: Stil je Kategorie, Attribute in der Beschreibung. */
/** `extra`: weitere KML-Ordner (Grundlagen), vor dem Dokumentende eingefügt. */
export function buildKml(projectName: string, features: BauFeature[], points: SurveyPoint[] = [], extra = ''): string {
  const used = CATEGORY_ORDER.filter((c) => features.some((f) => f.category === c))
  const styles = used
    .map((c) => {
      const m = CATEGORIES[c]
      return `<Style id="${c}"><LineStyle><color>${kmlColor(m.color)}</color><width>${m.width}</width></LineStyle><PolyStyle><color>${kmlColor(m.color, '55')}</color></PolyStyle></Style>`
    })
    .join('')
  const marks = features
    .map((f) => {
      const g = parseGeometry(f.geometry)
      if (!g) return ''
      return `<Placemark><name>${escapeXml(f.label ?? CATEGORIES[f.category].label)}</name><description>${escapeXml(featureDescription(f, g))}</description><styleUrl>#${f.category}</styleUrl>${geometryKml(g)}</Placemark>`
    })
    .join('\n')
  const pts = points.length
    ? `<Folder><name>Messpunkte</name>\n${points
        .map(
          (p) =>
            `<Placemark><name>P${String(p.point_no).padStart(3, '0')}</name><description>${escapeXml(
              [p.accuracy_m != null ? `Genauigkeit: ±${p.accuracy_m.toFixed(1)} m` : '', p.depth_cm != null ? `Tiefe: ${p.depth_cm} cm` : '', p.note ?? ''].filter(Boolean).join('\n'),
            )}</description><Point><coordinates>${p.lng.toFixed(7)},${p.lat.toFixed(7)},0</coordinates></Point></Placemark>`,
        )
        .join('\n')}</Folder>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(projectName)}</name>${styles}\n${marks}\n${pts}${extra ? `\n${extra}` : ''}</Document></kml>\n`
}

/** Grundlage Kulturflächen als KML-Ordner (nur Umriss, grün gestrichelt wie in der Karte). */
export function culturesKml(cultures: { name: string; geometry: Geom }[]): string {
  if (!cultures.length) return ''
  return `<Folder><name>Kulturflächen</name><Style id="kultur"><LineStyle><color>ff4aa316</color><width>1</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>\n${cultures
    .map((c) => `<Placemark><name>${escapeXml(c.name)}</name><styleUrl>#kultur</styleUrl>${geometryKml(c.geometry)}</Placemark>`)
    .join('\n')}</Folder>`
}
