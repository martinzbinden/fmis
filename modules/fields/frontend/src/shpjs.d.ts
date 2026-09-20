// shpjs hat keine offiziellen Typdefinitionen — minimale eigene Deklaration
// für die hier genutzten Low-Level-Funktionen (siehe lib/importFields.ts;
// wir nutzen bewusst nicht den High-Level-Export shp(buffer), siehe dort).
// Signaturen gegen node_modules/shpjs/lib/index.js (v6.2.0) verifiziert.
declare module 'shpjs' {
  interface GeoJsonGeometry {
    type: string
    coordinates: unknown
  }
  interface GeoJsonFeature {
    type: 'Feature'
    properties: Record<string, unknown>
    geometry: GeoJsonGeometry | null
  }
  interface GeoJsonFeatureCollection {
    type: 'FeatureCollection'
    features: GeoJsonFeature[]
  }

  // Ohne `prj`-Argument bleiben die Koordinaten unverändert im Quell-CRS
  // (kein automatisches Reprojizieren) — genau das nutzen wir aus, siehe
  // lib/importFields.ts für die explizite eigene Reprojektion.
  export function parseShp(buffer: ArrayBuffer, prj?: string | false): GeoJsonGeometry[]
  export function parseDbf(buffer: ArrayBuffer, cpg?: string): Record<string, unknown>[]
  export function combine(parts: [GeoJsonGeometry[], Record<string, unknown>[] | undefined]): GeoJsonFeatureCollection
}
