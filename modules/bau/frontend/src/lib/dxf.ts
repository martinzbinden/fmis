// DXF-Export für Bauunternehmer, Geometer und CAD (AutoCAD R2000, AC1015).
//
//  - Koordinaten in LV95 (EPSG:2056), Meter
//  - ein Layer je Kategorie (GUELLE, STROM, LEERROHR, SCHACHT, …), optional je Status
//  - Linien als LWPOLYLINE, Flächen als geschlossene LWPOLYLINE, Punkte als POINT
//    mit Beschriftung (TEXT), Messpunkte mit Höhe (GPS) und Punktnummer
//  - reines ASCII (Umlaute als \U+XXXX), damit keine Codepage-Probleme entstehen

import { CATEGORIES, CATEGORY_ORDER } from './categories'
import { parseGeometry } from './geometry'
import { pointLabel } from './csv'
import { wgs84ToLv95, type LngLat } from '@fmis/core/lv95'
import type { BauFeature, FeatureCategory, SurveyPoint } from '../types'

export interface DxfOptions {
  /** zusätzlich ein Layer je Status: GUELLE_GEPLANT, GUELLE_EINGEMESSEN … */
  statusLayers?: boolean
  /** Texthöhe in Metern (Zeichnungseinheit) */
  textHeight?: number
}

const NL = '\r\n'
const MEASURES = 'MESSPUNKTE'
const LABELS = 'BESCHRIFTUNG'

const num = (v: number, d = 3) => v.toFixed(d)

/** Text → reines ASCII (R2000: \U+XXXX für alles ausserhalb von ASCII). */
export function dxfText(s: string): string {
  return s
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, (ch) => `\\U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
}

/** Mittelpunkt einer Linie (nach Länge) und Richtung dort in rad, auf −90°…90° gedreht. */
export function midpointOf(pts: [number, number][]): { x: number; y: number; angle: number } {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  const total = seg.reduce((a, b) => a + b, 0)
  let rest = total / 2
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i] || i === seg.length - 1) {
      const f = seg[i] > 0 ? rest / seg[i] : 0
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      let angle = Math.atan2(y2 - y1, x2 - x1)
      if (angle > Math.PI / 2) angle -= Math.PI
      else if (angle < -Math.PI / 2) angle += Math.PI
      return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, angle }
    }
    rest -= seg[i]
  }
  return { x: pts[0][0], y: pts[0][1], angle: 0 }
}

const layerName = (cat: FeatureCategory, status: string, byStatus: boolean) =>
  byStatus ? `${CATEGORIES[cat].layer}_${status.toUpperCase()}` : CATEGORIES[cat].layer

export function buildDxf(features: BauFeature[], points: SurveyPoint[] = [], opts: DxfOptions = {}): string {
  const th = opts.textHeight ?? 1
  const byStatus = !!opts.statusLayers
  let counter = 0x20
  const next = () => (counter++).toString(16).toUpperCase()

  // --- Inhalt sammeln (LV95) ---
  type Ent = { kind: 'poly'; layer: string; pts: [number, number][]; closed: boolean } | { kind: 'point'; layer: string; p: [number, number, number] } | { kind: 'text'; layer: string; p: [number, number]; text: string; angle?: number }
  const ents: Ent[] = []
  const layers = new Map<string, number>() // Name → ACI
  const useLayer = (name: string, aci: number) => {
    if (!layers.has(name)) layers.set(name, aci)
    return name
  }
  let usesLabels = false
  const lv = (c: LngLat) => wgs84ToLv95(c)

  for (const cat of CATEGORY_ORDER) {
    for (const f of features.filter((x) => x.category === cat)) {
      const g = parseGeometry(f.geometry)
      if (!g) continue
      const layer = useLayer(layerName(cat, f.status, byStatus), CATEGORIES[cat].aci)
      const label = [f.label, f.diameter_mm != null ? `d${f.diameter_mm}` : ''].filter(Boolean).join(' ')
      if (g.type === 'Point') {
        const [e, n] = lv(g.coordinates)
        ents.push({ kind: 'point', layer, p: [e, n, 0] })
        if (label) ents.push({ kind: 'text', layer: LABELS, p: [e + th * 0.5, n + th * 0.5], text: label })
        usesLabels ||= !!label
      } else {
        const ring = g.type === 'LineString' ? g.coordinates : g.coordinates[0]
        const pts = ring.map(lv)
        ents.push({ kind: 'poly', layer, pts, closed: g.type === 'Polygon' })
        if (label) {
          // Beschriftung in der Linienmitte, parallel zur Linie (lesbar von links nach rechts)
          const m = midpointOf(pts)
          ents.push({ kind: 'text', layer: LABELS, p: [m.x - Math.sin(m.angle) * th * 0.6, m.y + Math.cos(m.angle) * th * 0.6], text: label, angle: (m.angle * 180) / Math.PI })
          usesLabels = true
        }
      }
    }
  }
  const ptsSorted = [...points].sort((a, b) => a.point_no - b.point_no)
  for (const sp of ptsSorted) {
    const [e, n] = lv([sp.lng, sp.lat])
    useLayer(MEASURES, 7)
    ents.push({ kind: 'point', layer: MEASURES, p: [e, n, sp.altitude_m ?? 0] })
    const label = `${pointLabel(sp.point_no)}${sp.altitude_m != null ? ` H${sp.altitude_m.toFixed(1)}` : ''}`
    ents.push({ kind: 'text', layer: LABELS, p: [e + th * 0.5, n + th * 0.5], text: label })
    usesLabels = true
  }
  if (usesLabels) useLayer(LABELS, 7)

  // --- Ausdehnung ---
  const xs: number[] = []
  const ys: number[] = []
  for (const e of ents) {
    if (e.kind === 'poly') e.pts.forEach(([x, y]) => (xs.push(x), ys.push(y)))
    else if (e.kind === 'point') (xs.push(e.p[0]), ys.push(e.p[1]))
    else (xs.push(e.p[0]), ys.push(e.p[1]))
  }
  const minX = xs.length ? Math.min(...xs) : 0
  const maxX = xs.length ? Math.max(...xs) : 100
  const minY = ys.length ? Math.min(...ys) : 0
  const maxY = ys.length ? Math.max(...ys) : 100

  // --- feste Handles der Tabellen/Blöcke ---
  const H = {
    vportTable: next(), ltypeTable: next(), layerTable: next(), styleTable: next(), viewTable: next(),
    ucsTable: next(), appidTable: next(), dimstyleTable: next(), brTable: next(),
    msRecord: next(), psRecord: next(), msBlock: next(), msEnd: next(), psBlock: next(), psEnd: next(),
    dictRoot: next(), dictGroup: next(),
  }

  const o: string[] = []
  const g = (code: number | string, value: string | number) => o.push(String(code).padStart(3, ' '), String(value))
  const section = (name: string) => (g(0, 'SECTION'), g(2, name))
  const endsec = () => g(0, 'ENDSEC')
  const table = (name: string, handle: string, count: number) => (g(0, 'TABLE'), g(2, name), g(5, handle), g(330, 0), g(100, 'AcDbSymbolTable'), g(70, count))
  const record = (type: string, owner: string, sub: string) => (g(0, type), g(5, next()), g(330, owner), g(100, 'AcDbSymbolTableRecord'), g(100, sub))

  // HEADER (HANDSEED folgt nach dem Zählen → Platzhalter, am Ende ersetzt)
  section('HEADER')
  g(9, '$ACADVER'); g(1, 'AC1015')
  g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252')
  g(9, '$HANDSEED'); g(5, '@@SEED@@')
  g(9, '$INSUNITS'); g(70, 6)
  g(9, '$MEASUREMENT'); g(70, 1)
  g(9, '$EXTMIN'); g(10, num(minX)); g(20, num(minY)); g(30, 0)
  g(9, '$EXTMAX'); g(10, num(maxX)); g(20, num(maxY)); g(30, 0)
  endsec()
  section('CLASSES'); endsec()

  section('TABLES')
  table('VPORT', H.vportTable, 1)
  record('VPORT', H.vportTable, 'AcDbViewportTableRecord')
  g(2, '*Active'); g(70, 0)
  g(10, 0); g(20, 0); g(11, 1); g(21, 1)
  g(12, num((minX + maxX) / 2)); g(22, num((minY + maxY) / 2))
  g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10); g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0)
  g(40, num(Math.max(maxY - minY, (maxX - minX) / 1.5, 20) * 1.2)); g(41, '1.5'); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0)
  g(71, 0); g(72, 1000); g(73, 1); g(74, 3); g(75, 0); g(76, 0); g(77, 0); g(78, 0)
  g(0, 'ENDTAB')

  table('LTYPE', H.ltypeTable, 3)
  for (const [name, desc] of [['ByBlock', ''], ['ByLayer', ''], ['CONTINUOUS', 'Solid line']] as const) {
    record('LTYPE', H.ltypeTable, 'AcDbLinetypeTableRecord')
    g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, 0); g(40, '0.0')
  }
  g(0, 'ENDTAB')

  table('LAYER', H.layerTable, layers.size + 1)
  record('LAYER', H.layerTable, 'AcDbLayerTableRecord'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS')
  for (const [name, aci] of layers) {
    record('LAYER', H.layerTable, 'AcDbLayerTableRecord'); g(2, name); g(70, 0); g(62, aci); g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')

  table('STYLE', H.styleTable, 1)
  record('STYLE', H.styleTable, 'AcDbTextStyleTableRecord')
  g(2, 'Standard'); g(70, 0); g(40, '0.0'); g(41, '1.0'); g(50, '0.0'); g(71, 0); g(42, '2.5'); g(3, 'txt'); g(4, '')
  g(0, 'ENDTAB')

  table('VIEW', H.viewTable, 0); g(0, 'ENDTAB')
  table('UCS', H.ucsTable, 0); g(0, 'ENDTAB')

  table('APPID', H.appidTable, 1)
  record('APPID', H.appidTable, 'AcDbRegAppTableRecord'); g(2, 'ACAD'); g(70, 0)
  g(0, 'ENDTAB')

  table('DIMSTYLE', H.dimstyleTable, 0); g(100, 'AcDbDimStyleTable'); g(71, 0); g(0, 'ENDTAB')

  // BLOCK_RECORD mit festen Handles (die Blöcke verweisen darauf)
  g(0, 'TABLE'); g(2, 'BLOCK_RECORD'); g(5, H.brTable); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, 2)
  for (const [handle, name] of [[H.msRecord, '*Model_Space'], [H.psRecord, '*Paper_Space']] as const) {
    g(0, 'BLOCK_RECORD'); g(5, handle); g(330, H.brTable); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, name)
  }
  g(0, 'ENDTAB')
  endsec()

  section('BLOCKS')
  for (const [record, begin, end, name, paper] of [
    [H.msRecord, H.msBlock, H.msEnd, '*Model_Space', false],
    [H.psRecord, H.psBlock, H.psEnd, '*Paper_Space', true],
  ] as const) {
    g(0, 'BLOCK'); g(5, begin); g(330, record); g(100, 'AcDbEntity'); if (paper) g(67, 1); g(8, '0')
    g(100, 'AcDbBlockBegin'); g(2, name); g(70, 0); g(10, 0); g(20, 0); g(30, 0); g(3, name); g(1, '')
    g(0, 'ENDBLK'); g(5, end); g(330, record); g(100, 'AcDbEntity'); if (paper) g(67, 1); g(8, '0'); g(100, 'AcDbBlockEnd')
  }
  endsec()

  section('ENTITIES')
  const head = (type: string, layer: string, sub: string) => (g(0, type), g(5, next()), g(330, H.msRecord), g(100, 'AcDbEntity'), g(8, layer), g(100, sub))
  for (const e of ents) {
    if (e.kind === 'poly') {
      head('LWPOLYLINE', e.layer, 'AcDbPolyline')
      // Geschlossene Fläche: Schlusspunkt = Startpunkt entfällt, das Flag schliesst
      const pts = e.closed && e.pts.length > 1 ? e.pts.slice(0, -1) : e.pts
      g(90, pts.length); g(70, e.closed ? 1 : 0); g(43, '0.0')
      for (const [x, y] of pts) (g(10, num(x)), g(20, num(y)))
    } else if (e.kind === 'point') {
      head('POINT', e.layer, 'AcDbPoint')
      g(10, num(e.p[0])); g(20, num(e.p[1])); g(30, num(e.p[2]))
    } else {
      head('TEXT', e.layer, 'AcDbText')
      g(10, num(e.p[0])); g(20, num(e.p[1])); g(30, 0); g(40, num(th, 2)); g(1, dxfText(e.text)); g(50, num(e.angle ?? 0, 2)); g(100, 'AcDbText')
    }
  }
  endsec()

  section('OBJECTS')
  g(0, 'DICTIONARY'); g(5, H.dictRoot); g(330, 0); g(100, 'AcDbDictionary'); g(281, 1); g(3, 'ACAD_GROUP'); g(350, H.dictGroup)
  g(0, 'DICTIONARY'); g(5, H.dictGroup); g(330, H.dictRoot); g(100, 'AcDbDictionary'); g(281, 1)
  endsec()
  g(0, 'EOF')

  const seed = counter.toString(16).toUpperCase()
  const lines: string[] = []
  for (let i = 0; i < o.length; i += 2) lines.push(o[i], o[i + 1].replace('@@SEED@@', seed))
  return lines.join(NL) + NL
}
