// Export eines Projekts: Auswahl, Formate, Dateinamen.

import { buildSurveyCsv } from './csv'
import { buildDxf } from './dxf'
import { buildGeoJson } from './geojson'
import { buildGpx } from './gpx'
import { buildKml } from './kml'
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
}

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

export async function buildExport(kind: ExportKind, input: ExportInput): Promise<ExportFile> {
  const { features, points } = selectForExport(input)
  const name = (ext: string) => exportFileName(input.projectName, ext, input.date)
  switch (kind) {
    case 'kml':
      return { name: name('kml'), mime: 'application/vnd.google-earth.kml+xml', data: buildKml(input.projectName, features, points) }
    case 'kmz':
      return { name: name('kmz'), mime: 'application/vnd.google-earth.kmz', data: await buildKmz(buildKml(input.projectName, features, points)) }
    case 'dxf':
      return { name: name('dxf'), mime: 'application/dxf', data: buildDxf(features, points, { statusLayers: input.dxfStatusLayers }) }
    case 'geojson':
      return { name: name('geojson'), mime: 'application/geo+json', data: buildGeoJson(input.projectName, features, points) }
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
