// Aus fmis core/frontend/src/swisstopo.ts (59425bb).
// swisstopo-Kartendienste (öffentlich, kein API-Key; Attribution «© swisstopo»).
// WMTS in EPSG:3857 (Web-Mercator), passt zu Leaflets Standard-CRS.

export const BACKGROUND_LAYERS = {
  swissimage: { label: 'Luftbild', wmtsLayer: 'ch.swisstopo.swissimage', maxZoom: 20, ext: 'jpeg' },
  pixelkarte: { label: 'Landeskarte', wmtsLayer: 'ch.swisstopo.pixelkarte-farbe', maxZoom: 18, ext: 'jpeg' },
  pixelkarte_grau: { label: 'Karte grau', wmtsLayer: 'ch.swisstopo.pixelkarte-grau', maxZoom: 18, ext: 'jpeg' },
} as const

export type BackgroundKey = keyof typeof BACKGROUND_LAYERS

export function swisstopoUrl(key: BackgroundKey): string {
  const l = BACKGROUND_LAYERS[key]
  return `https://wmts.geo.admin.ch/1.0.0/${l.wmtsLayer}/default/current/3857/{z}/{x}/{y}.${l.ext}`
}

export const SWISSTOPO_ATTRIBUTION = '© swisstopo'
