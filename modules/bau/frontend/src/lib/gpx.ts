// GPX 1.1: Leitungen/Flächen als Tracks, Punkte (Schächte, Gebäude) und
// Messpunkte als Wegpunkte — für GPS-Geräte und Navi-Apps im Feld.

import { CATEGORIES } from './categories'
import { parseGeometry } from './geometry'
import { escapeXml } from './text'
import type { BauFeature, SurveyPoint } from '../types'
import type { LngLat } from '@fmis/core/lv95'

const pt = (tagName: string, c: LngLat, inner = '') =>
  `<${tagName} lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">${inner}</${tagName}>`

export function buildGpx(projectName: string, features: BauFeature[], points: SurveyPoint[] = []): string {
  const wpts: string[] = []
  const trks: string[] = []
  for (const f of features) {
    const g = parseGeometry(f.geometry)
    if (!g) continue
    const name = escapeXml(f.label ?? CATEGORIES[f.category].label)
    const desc = escapeXml(`${CATEGORIES[f.category].label}, ${f.status}`)
    if (g.type === 'Point') wpts.push(pt('wpt', g.coordinates, `<name>${name}</name><desc>${desc}</desc>`))
    else {
      const ring = g.type === 'LineString' ? g.coordinates : g.coordinates[0]
      trks.push(`<trk><name>${name}</name><desc>${desc}</desc><trkseg>${ring.map((c) => pt('trkpt', c)).join('')}</trkseg></trk>`)
    }
  }
  for (const p of points) {
    const ele = p.altitude_m != null ? `<ele>${p.altitude_m.toFixed(1)}</ele>` : ''
    wpts.push(pt('wpt', [p.lng, p.lat], `${ele}<name>P${String(p.point_no).padStart(3, '0')}</name>${p.note ? `<desc>${escapeXml(p.note)}</desc>` : ''}`))
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FMIS" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(projectName)}</name></metadata>\n${wpts.join('\n')}\n${trks.join('\n')}\n</gpx>\n`
}
