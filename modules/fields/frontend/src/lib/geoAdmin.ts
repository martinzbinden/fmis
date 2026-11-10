// Link auf map.geo.admin.ch: Parzelle zentriert, Luftbild, landwirtschaftliche Layer in
// der Layerliste. Aktiv nur Nutzungsflächen und Bewirtschaftungseinheiten, die übrigen
// sind geladen, aber ausgeschaltet (Häkchen in «Dargestellte Karten»).
//
// URL-Format des Kartenviewers: layers=<id>[,f];… (f = ausgeblendet, spätere liegen oben),
// externe WMS als WMS|<Basis-URL>|<Layername>. Bewirtschaftungseinheiten, BFF QII/
// Vernetzung, Perimeter LN/SF und Gewässerschutz gibt es nur bei geodienste.ch (Kantone).
import { wgs84ToLv95, type LngLat } from '@fmis/core/lv95'

const GEODIENSTE = 'https://geodienste.ch/db'

/** Unten zuerst; [Layer, sichtbar] */
export const GEO_ADMIN_LAYERS: [string, boolean][] = [
  ['ch.kantone.cadastralwebmap-farbe', false], // amtliche Vermessung
  ['ch.blw.bodeneignung-kulturland', false],
  ['ch.blw.erosion', false],
  ['ch.blw.gewaesseranschlusskarte', false],
  ['ch.blw.feldblockkarte', false],
  [`WMS|${GEODIENSTE}/planerischer_gewaesserschutz_v1_2_0/deu|gewaesserschutzkarte`, false],
  ['ch.bafu.bundesinventare-trockenwiesen_trockenweiden', false],
  ['ch.blw.hang_steillagen', false],
  ['ch.blw.landwirtschaftliche-zonengrenzen', false],
  [`WMS|${GEODIENSTE}/lwb_perimeter_ln_sf_v2_0_0/deu|perimeter_ln_sf`, false],
  [`WMS|${GEODIENSTE}/lwb_biodiversitaetsfoerderflaechen_v2_0_0/deu|bff_vernetzung_flaechen`, false],
  [`WMS|${GEODIENSTE}/lwb_biodiversitaetsfoerderflaechen_v2_0_0/deu|bff_qualitaet_2_flaechen`, false],
  ['ch.blw.landwirtschaftliche-nutzungsflaechen', true],
  [`WMS|${GEODIENSTE}/lwb_bewirtschaftungseinheit_v2_0_0/deu|bewirtschaftungseinheit`, true],
]

function collect(coords: unknown, out: LngLat[]): void {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') out.push([coords[0], coords[1]])
  else for (const c of coords) collect(c, out)
}

/** Zoomstufe des Viewers nach Ausdehnung in Metern (10 ≈ Massstab 100 m auf gut 2 cm). */
function zoomFor(extentM: number): number {
  if (extentM > 2000) return 8
  if (extentM > 800) return 9
  if (extentM > 250) return 10
  return 11
}

/** Link für eine GeoJSON-Geometrie (WGS84, als Text wie in field_declarations.geometry); null ohne Koordinaten. */
export function geoAdminUrl(geometry: string | null): string | null {
  if (!geometry) return null
  const pts: LngLat[] = []
  try {
    collect((JSON.parse(geometry) as { coordinates?: unknown }).coordinates, pts)
  } catch {
    return null
  }
  if (pts.length === 0) return null
  const lv = pts.map(wgs84ToLv95)
  const es = lv.map((p) => p[0])
  const ns = lv.map((p) => p[1])
  const [minE, maxE, minN, maxN] = [Math.min(...es), Math.max(...es), Math.min(...ns), Math.max(...ns)]
  const center = `${Math.round((minE + maxE) / 2)},${Math.round((minN + maxN) / 2)}`
  const layers = GEO_ADMIN_LAYERS.map(([id, on]) => (on ? id : `${id},f`)).join(';')
  return `https://map.geo.admin.ch/#/map?lang=de&center=${center}&z=${zoomFor(Math.max(maxE - minE, maxN - minN))}&bgLayer=ch.swisstopo.swissimage&crosshair=marker&layers=${layers}`
}
