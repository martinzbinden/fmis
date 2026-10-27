// Export eines Projekts: Auswahl, Formate, Dateinamen.

import JSZip from 'jszip'
import { buildRasters, groundOverlaysKml, LV95_PRJ, worldFile, areaResolution, type Area, type BasemapChoice, type CultureArea, type ExportRaster } from './basemapExport'
import { buildSurveyCsv } from './csv'
import { buildDxf } from './dxf'
import { buildGeoJson } from './geojson'
import { buildGpx } from './gpx'
import { buildKml, culturesKml } from './kml'
import { buildKmz } from './kmz'
import { exportFileName } from './text'
import type { BauFeature, SurveyPoint } from '../types'

export type ExportKind = 'kml' | 'kmz' | 'dxf' | 'geojson' | 'gpx' | 'csv'

export const EXPORT_LABEL: Record<ExportKind, { label: string; hint: string }> = {
  kmz: { label: 'KMZ', hint: 'map.geo.admin.ch, swisstopo-App, Google Earth' },
  kml: { label: 'KML', hint: 'wie KMZ, unkomprimiert' },
  dxf: { label: 'DXF', hint: 'Bauunternehmer, Geometer, CAD (LV95, Meter)' },
  geojson: { label: 'GeoJSON', hint: 'QGIS und andere GIS (alle Attribute)' },
  gpx: { label: 'GPX', hint: 'GPS-Geräte und Navi-Apps im Feld' },
  csv: { label: 'CSV Messpunkte', hint: 'Austausch mit dem Geometer (E/N LV95)' },
}

export interface ExportInput {
  projectName: string
  features: BauFeature[]
  points: SurveyPoint[]
  /** null = alle Objekte des Projekts */
  selectedIds: ReadonlySet<string> | null
  /** YYYY-MM-DD für den Dateinamen */
  date: string
  dxfStatusLayers?: boolean
  includeDiscarded?: boolean
  /** Grundlagen im Gebiet (KMZ, KML nur Vektoren, DXF/GeoJSON mit Bildern als ZIP) */
  basemaps?: { area: Area; choice: BasemapChoice; cultures: CultureArea[] }
}

/** Formate, die Grundlagen mitnehmen: Bilder nur KMZ, DXF, GeoJSON; KML nur Kulturflächen. */
export const BASEMAP_KINDS: ReadonlySet<ExportKind> = new Set(['kmz', 'kml', 'dxf', 'geojson'])

export interface ExportFile {
  name: string
  mime: string
  data: string | Uint8Array
}

/** Objekte und Messpunkte nach Auswahl; verworfene fehlen, ausser ausdrücklich gewünscht. */
export function selectForExport(i: Pick<ExportInput, 'features' | 'points' | 'selectedIds' | 'includeDiscarded'>) {
  const features = i.features.filter((f) => (i.selectedIds ? i.selectedIds.has(f.id) : i.includeDiscarded || f.status !== 'verworfen'))
  const ids = new Set(features.map((f) => f.id))
  // Bei einer Auswahl nur die Messpunkte der gewählten Objekte
  const points = i.selectedIds ? i.points.filter((p) => p.feature_id != null && ids.has(p.feature_id)) : i.points
  return { features, points }
}

/** Datei + Bilder mit Worldfile (LV95) in ein ZIP. */
async function withRasters(main: ExportFile, rasters: ExportRaster[], area: Area, zipName: string): Promise<ExportFile> {
  if (!rasters.length) return main
  const zip = new JSZip()
  zip.file(main.name, main.data)
  const res = areaResolution(area)
  for (const r of rasters) {
    zip.file(`grundlagen/${r.base}.${r.ext}`, r.data)
    zip.file(`grundlagen/${r.base}.${r.ext === 'png' ? 'pgw' : 'jgw'}`, worldFile(area, res))
    zip.file(`grundlagen/${r.base}.prj`, LV95_PRJ)
  }
  zip.file(
    'grundlagen/LIESMICH.txt',
    `Grundlagen als Rasterbilder in LV95 (EPSG:2056), je Bild mit Worldfile (.pgw/.jgw) und .prj.\r\n` +
      `Gebiet: E ${area.e0}–${area.e1}, N ${area.n0}–${area.n1}, ${res.toFixed(2)} m je Pixel.\r\n` +
      `CAD: Rasterbild einfügen und mit dem Worldfile platzieren (z.B. AutoCAD Map/Civil, BricsCAD: «Geo-Bild einfügen»). QGIS: Datei einfach öffnen.\r\n` +
      `Leitungskataster © Amt für Geoinformation des Kantons Bern; Gemeinden. Parzellen und Luftbild © swisstopo / Kantone. Nur informativ, nicht rechtsverbindlich.\r\n`,
  )
  return { name: zipName, mime: 'application/zip', data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) }
}

export async function buildExport(kind: ExportKind, input: ExportInput): Promise<ExportFile> {
  const { features, points } = selectForExport(input)
  const name = (ext: string) => exportFileName(input.projectName, ext, input.date)
  const bm = input.basemaps
  const cultures = bm?.cultures ?? []
  switch (kind) {
    case 'kml':
      return { name: name('kml'), mime: 'application/vnd.google-earth.kml+xml', data: buildKml(input.projectName, features, points, culturesKml(cultures)) }
    case 'kmz': {
      const rasters = bm ? await buildRasters(bm.choice, bm.area, true) : []
      const kml = buildKml(input.projectName, features, points, [groundOverlaysKml(rasters), culturesKml(cultures)].filter(Boolean).join('\n'))
      return { name: name('kmz'), mime: 'application/vnd.google-earth.kmz', data: await buildKmz(kml, rasters.map((r) => ({ path: `files/${r.base}.${r.ext}`, data: r.data }))) }
    }
    case 'dxf': {
      const extra = cultures.length ? [{ layer: 'GRUNDLAGE_KULTUREN', aci: 3, rings: cultures.flatMap((c) => (c.geometry.type === 'Polygon' ? [c.geometry.coordinates[0]] : [])) }] : []
      const dxf: ExportFile = { name: name('dxf'), mime: 'application/dxf', data: buildDxf(features, points, { statusLayers: input.dxfStatusLayers, extra }) }
      return bm ? withRasters(dxf, await buildRasters(bm.choice, bm.area, false), bm.area, name('dxf.zip')) : dxf
    }
    case 'geojson': {
      const gj: ExportFile = { name: name('geojson'), mime: 'application/geo+json', data: buildGeoJson(input.projectName, features, points, cultures) }
      return bm ? withRasters(gj, await buildRasters(bm.choice, bm.area, false), bm.area, name('geojson.zip')) : gj
    }
    case 'gpx':
      return { name: name('gpx'), mime: 'application/gpx+xml', data: buildGpx(input.projectName, features, points) }
    case 'csv':
      return { name: name('csv'), mime: 'text/csv;charset=utf-8', data: buildSurveyCsv(points, features) }
  }
}

/** Browser-Download. */
export function downloadFile(file: ExportFile): void {
  const blob = new Blob([file.data as BlobPart], { type: file.mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
