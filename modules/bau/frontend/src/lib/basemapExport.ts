// Grundlagen im Export: Leitungskataster (hochgeladene Ebenen), Parzellen und Luftbild (swisstopo-WMS,
// braucht Internet) als Rasterbilder, Kulturflächen als Vektoren. Gebiet: LV95-Rechteck um die
// exportierten Objekte plus Puffer.
//
// - KMZ: Bilder als GroundOverlay (WGS84-Ausschnitt), Kulturflächen als Placemarks.
// - DXF/GeoJSON: ZIP mit der Datei und je Bild PNG/JPG + Worldfile + .prj in LV95 (EPSG:2056),
//   in CAD/GIS als Rasterbild einfügbar.

import { lv95ToWgs84, wgs84ToLv95, type LngLat } from '@fmis/core/lv95'
import { parseGeometry, type Geom } from './geometry'
import type { BauFeature, BauOverlay, SurveyPoint } from '../types'

/** Rechteck in LV95 (Meter). */
export interface Area {
  e0: number
  n0: number
  e1: number
  n1: number
}

export const DEFAULT_BUFFER_M = 100

/** Projektperimeter (Objekte und Messpunkte) plus Puffer, auf ganze Meter gerundet. */
export function exportArea(features: Pick<BauFeature, 'geometry'>[], points: Pick<SurveyPoint, 'lat' | 'lng'>[], bufferM = DEFAULT_BUFFER_M): Area | null {
  const cs: LngLat[] = []
  for (const f of features) {
    const g = parseGeometry(f.geometry)
    if (!g) continue
    if (g.type === 'Point') cs.push(g.coordinates)
    else if (g.type === 'LineString') cs.push(...g.coordinates)
    else cs.push(...g.coordinates.flat())
  }
  for (const p of points) cs.push([p.lng, p.lat])
  if (!cs.length) return null
  const lv = cs.map(wgs84ToLv95)
  const b = Math.max(0, bufferM)
  return {
    e0: Math.floor(Math.min(...lv.map((p) => p[0])) - b),
    n0: Math.floor(Math.min(...lv.map((p) => p[1])) - b),
    e1: Math.ceil(Math.max(...lv.map((p) => p[0])) + b),
    n1: Math.ceil(Math.max(...lv.map((p) => p[1])) + b),
  }
}

/** Ecken des Gebiets in WGS84 (für die Anzeige auf der Karte). */
export const areaCorners = (a: Area): LngLat[] => [lv95ToWgs84([a.e0, a.n0]), lv95ToWgs84([a.e1, a.n0]), lv95ToWgs84([a.e1, a.n1]), lv95ToWgs84([a.e0, a.n1])]

/** Umhüllendes Rechteck in WGS84: [west, south, east, north]. */
export function areaWgs84(a: Area): [number, number, number, number] {
  const c = areaCorners(a)
  return [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))]
}

/** Auflösung in m/Pixel: fein genug für Leitungen, höchstens 4000 Pixel je Seite (Grenze des WMS). */
export const areaResolution = (a: Area) => Math.max(0.15, Math.max(a.e1 - a.e0, a.n1 - a.n0) / 4000)

/** Worldfile (.pgw/.jgw) für ein Bild in LV95: Mitte des Pixels oben links. */
export function worldFile(a: Area, res: number): string {
  return [res, 0, 0, -res, a.e0 + res / 2, a.n1 - res / 2].map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(4))).join('\n') + '\n'
}

export const LV95_PRJ =
  'PROJCS["CH1903+_LV95",GEOGCS["GCS_CH1903+",DATUM["D_CH1903+",SPHEROID["Bessel_1841",6377397.155,299.1528128]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
  'PROJECTION["Hotine_Oblique_Mercator_Azimuth_Center"],PARAMETER["False_Easting",2600000.0],PARAMETER["False_Northing",1200000.0],PARAMETER["Scale_Factor",1.0],' +
  'PARAMETER["Azimuth",90.0],PARAMETER["Longitude_Of_Center",7.439583333333333],PARAMETER["Latitude_Of_Center",46.95240555555556],UNIT["Meter",1.0]]'

// ---------------------------------------------------------------- Bilder

/** Ein Rasterbild für den Export. */
export interface ExportRaster {
  /** Dateiname ohne Endung, z.B. «grundlage_wasser» */
  base: string
  name: string
  ext: 'png' | 'jpg'
  data: Uint8Array
  /** nur KMZ: Ausdehnung in WGS84 */
  box?: { west: number; south: number; east: number; north: number }
}

const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invMerc = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90

async function loadImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob)
}

/** Bild einer hochgeladenen Ebene (erst hier geladen: lib/overlays zieht den Sync-Client mit). */
async function overlayBitmap(id: string): Promise<ImageBitmap> {
  const { overlayUrl } = await import('./overlays')
  return loadImage(await (await fetch(await overlayUrl(id))).blob())
}

async function canvasBytes(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, 0.88))
  if (!blob) throw new Error('Bild konnte nicht erstellt werden')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Weiss → durchsichtig (Parzellenplan des WMS ist deckend weiss). */
function whiteToAlpha(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d')!
  const d = ctx.getImageData(0, 0, c.width, c.height)
  const p = d.data
  for (let i = 0; i < p.length; i += 4) {
    const t = 1 - Math.min(p[i], p[i + 1], p[i + 2]) / 255
    if (t <= 0) {
      p[i + 3] = 0
      continue
    }
    for (let k = 0; k < 3; k++) p[i + k] = Math.max(0, Math.min(255, 255 - (255 - p[i + k]) / t))
    p[i + 3] = Math.round(p[i + 3] * t)
  }
  ctx.putImageData(d, 0, 0)
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'ebene'

/** Hochgeladene Ebene (Kartenprojektion) → LV95-Rechteck des Gebiets (affin, auf wenige cm genau). */
async function overlayToLv95(o: BauOverlay, a: Area, res: number): Promise<Uint8Array | null> {
  const img = await overlayBitmap(o.id)
  const W = Math.round((a.e1 - a.e0) / res)
  const H = Math.round((a.n1 - a.n0) / res)
  const yN = merc(o.north)
  const yS = merc(o.south)
  // Zielpixel → Quellpixel für drei Ecken, daraus die affine Abbildung
  const src = (u: number, v: number) => {
    const [lon, lat] = lv95ToWgs84([a.e0 + u * res, a.n1 - v * res])
    return [((lon - o.west) / (o.east - o.west)) * img.width, ((yN - merc(lat)) / (yN - yS)) * img.height]
  }
  const [x0, y0] = src(0, 0)
  const [x1, y1] = src(W, 0)
  const [x2, y2] = src(0, H)
  // src = M·dest + t, M = [[a b][c d]]
  const ma = (x1 - x0) / W
  const mc = (y1 - y0) / W
  const mb = (x2 - x0) / H
  const md = (y2 - y0) / H
  const det = ma * md - mb * mc
  // dest = M⁻¹·(src − t)
  const ia = md / det
  const ib = -mb / det
  const ic = -mc / det
  const id = ma / det
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(ia, ic, ib, id, -(ia * x0 + ib * y0), -(ic * x0 + id * y0))
  ctx.drawImage(img, 0, 0)
  if (!ctx.getImageData(0, 0, W, H).data.some((v, i) => i % 4 === 3 && v > 0)) return null // Ebene liegt ausserhalb
  return canvasBytes(canvas, 'image/png')
}

/** Hochgeladene Ebene → Ausschnitt in WGS84 für KMZ (die Kartenprojektion ist längen-/breitentreu genug auf wenigen 100 m). */
async function overlayToKmz(o: BauOverlay, a: Area): Promise<{ data: Uint8Array; box: NonNullable<ExportRaster['box']> } | null> {
  const [w, s, e, n] = areaWgs84(a)
  const west = Math.max(w, o.west)
  const east = Math.min(e, o.east)
  const south = Math.max(s, o.south)
  const north = Math.min(n, o.north)
  if (west >= east || south >= north) return null
  const img = await overlayBitmap(o.id)
  const yN = merc(o.north)
  const yS = merc(o.south)
  const sx0 = Math.floor(((west - o.west) / (o.east - o.west)) * img.width)
  const sx1 = Math.ceil(((east - o.west) / (o.east - o.west)) * img.width)
  const sy0 = Math.floor(((yN - merc(north)) / (yN - yS)) * img.height)
  const sy1 = Math.ceil(((yN - merc(south)) / (yN - yS)) * img.height)
  const canvas = document.createElement('canvas')
  canvas.width = sx1 - sx0
  canvas.height = sy1 - sy0
  canvas.getContext('2d')!.drawImage(img, sx0, sy0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
  return {
    data: await canvasBytes(canvas, 'image/png'),
    box: {
      west: o.west + (sx0 / img.width) * (o.east - o.west),
      east: o.west + (sx1 / img.width) * (o.east - o.west),
      north: invMerc(yN - (sy0 / img.height) * (yN - yS)),
      south: invMerc(yN - (sy1 / img.height) * (yN - yS)),
    },
  }
}

export const WMS_LAYERS = {
  parzellen: { name: 'Parzellen (amtliche Vermessung)', layer: 'ch.kantone.cadastralwebmap-farbe', format: 'image/png' as const, transparent: true },
  luftbild: { name: 'Luftbild (swisstopo)', layer: 'ch.swisstopo.swissimage', format: 'image/jpeg' as const, transparent: false },
}
export type WmsKey = keyof typeof WMS_LAYERS

async function wms(key: WmsKey, crs: 'EPSG:2056' | 'CRS:84', bbox: number[], W: number, H: number): Promise<Uint8Array> {
  const l = WMS_LAYERS[key]
  const url = `https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${l.layer}&STYLES=&CRS=${crs}&BBOX=${bbox.join(',')}&WIDTH=${W}&HEIGHT=${H}&FORMAT=${encodeURIComponent(l.format)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error(`${l.name}: braucht Internet`)
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`${l.name}: swisstopo-Dienst nicht verfügbar (${res.status})`)
  const blob = await res.blob()
  if (!l.transparent) return new Uint8Array(await blob.arrayBuffer())
  const img = await loadImage(blob)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  whiteToAlpha(canvas)
  return canvasBytes(canvas, 'image/png')
}

export interface BasemapChoice {
  overlays: BauOverlay[]
  wms: WmsKey[]
}

/** Alle gewählten Bilder für das Gebiet; `kmz` = WGS84-Ausschnitte, sonst LV95 mit Worldfile. */
export async function buildRasters(choice: BasemapChoice, a: Area, kmz: boolean): Promise<ExportRaster[]> {
  const out: ExportRaster[] = []
  const res = areaResolution(a)
  const W = Math.round((a.e1 - a.e0) / res)
  const H = Math.round((a.n1 - a.n0) / res)
  // Luftbild zuunterst
  for (const key of [...choice.wms].sort((x, y) => (x === 'luftbild' ? -1 : y === 'luftbild' ? 1 : 0))) {
    const l = WMS_LAYERS[key]
    const ext = l.format === 'image/jpeg' ? 'jpg' : 'png'
    if (kmz) {
      const [w, s, e, n] = areaWgs84(a)
      out.push({ base: `grundlage_${key}`, name: l.name, ext, data: await wms(key, 'CRS:84', [w, s, e, n], W, H), box: { west: w, south: s, east: e, north: n } })
    } else {
      out.push({ base: `grundlage_${key}`, name: l.name, ext, data: await wms(key, 'EPSG:2056', [a.e0, a.n0, a.e1, a.n1], W, H) })
    }
  }
  for (const o of choice.overlays) {
    const base = `grundlage_${slug(o.group_name)}_${slug(o.name)}`.slice(0, 80)
    if (kmz) {
      const r = await overlayToKmz(o, a)
      if (r) out.push({ base, name: `${o.group_name}: ${o.name}`, ext: 'png', data: r.data, box: r.box })
    } else {
      const data = await overlayToLv95(o, a, res)
      if (data) out.push({ base, name: `${o.group_name}: ${o.name}`, ext: 'png', data })
    }
  }
  return out
}

/** KML-Ordner mit den Bildern als GroundOverlay (Dateien liegen im KMZ unter files/). */
export function groundOverlaysKml(rasters: ExportRaster[]): string {
  if (!rasters.length) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<Folder><name>Grundlagen</name>\n${rasters
    .filter((r) => r.box)
    .map(
      (r, i) =>
        `<GroundOverlay><name>${esc(r.name)}</name><drawOrder>${i}</drawOrder><Icon><href>files/${r.base}.${r.ext}</href></Icon><LatLonBox><north>${r.box!.north.toFixed(8)}</north><south>${r.box!.south.toFixed(8)}</south><east>${r.box!.east.toFixed(8)}</east><west>${r.box!.west.toFixed(8)}</west></LatLonBox></GroundOverlay>`,
    )
    .join('\n')}</Folder>`
}

// ---------------------------------------------------------------- Kulturflächen

export interface CultureArea {
  name: string
  geometry: Geom
}

/** Kulturflächen (Modul Kulturen), die das Gebiet berühren. */
export function culturesInArea(list: { flurname: string | null; kulturName: string | null; geometry: string }[], a: Area): CultureArea[] {
  const [w, s, e, n] = areaWgs84(a)
  return list.flatMap((c) => {
    const g = parseGeometry(c.geometry)
    if (!g || g.type !== 'Polygon') return []
    const ring = g.coordinates[0]
    const hit = !(Math.max(...ring.map((p) => p[0])) < w || Math.min(...ring.map((p) => p[0])) > e || Math.max(...ring.map((p) => p[1])) < s || Math.min(...ring.map((p) => p[1])) > n)
    return hit ? [{ name: [c.flurname, c.kulturName].filter(Boolean).join(' · ') || 'Kulturfläche', geometry: g }] : []
  })
}
