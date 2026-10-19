// swisstopo-Kartendienste (öffentlich, kein API-Key; Attribution «© swisstopo»).
// Gemeinsam für alle Karten in FMIS (vorher doppelt in FieldMap/PlanningMap).
// WMTS in EPSG:3857 (Web-Mercator), passt zu Leaflets Standard-CRS.

export const BACKGROUND_LAYERS = {
  pixelkarte: { label: 'Landeskarte', wmtsLayer: 'ch.swisstopo.pixelkarte-farbe', maxZoom: 18 },
  pixelkarte_grau: { label: 'Landeskarte grau', wmtsLayer: 'ch.swisstopo.pixelkarte-grau', maxZoom: 18 },
  swissimage: { label: 'Luftbild', wmtsLayer: 'ch.swisstopo.swissimage', maxZoom: 20 },
} as const

export type BackgroundKey = keyof typeof BACKGROUND_LAYERS

export function swisstopoUrl(wmtsLayer: string): string {
  return `https://wmts.geo.admin.ch/1.0.0/${wmtsLayer}/default/current/3857/{z}/{x}/{y}.jpeg`
}

export const SWISSTOPO_ATTRIBUTION = '© swisstopo'

/** Parzellen der amtlichen Vermessung (Kantone, WMS; nicht rechtsverbindlich). */
export const CADASTRE_WMS = {
  url: 'https://wms.geo.admin.ch/',
  layers: 'ch.kantone.cadastralwebmap-farbe',
  attribution: '© swisstopo · Kantone (amtliche Vermessung, nicht rechtsverbindlich)',
} as const
