import type { FeatureCategory, FeatureStatus, ProjectStatus } from '../types'

export interface CategoryMeta {
  label: string
  /** Kartenfarbe und KML/GPX */
  color: string
  /** Linienbreite in der Karte/KML */
  width: number
  /** DXF-Layername (A–Z, 0–9, _) */
  layer: string
  /** AutoCAD-Farbindex */
  aci: number
  icon: string
}

export const CATEGORIES: Record<FeatureCategory, CategoryMeta> = {
  guelle: { label: 'Gülle', color: '#92400e', width: 4, layer: 'GUELLE', aci: 30, icon: '🛢️' },
  strom: { label: 'Strom', color: '#dc2626', width: 3, layer: 'STROM', aci: 1, icon: '⚡' },
  wasser: { label: 'Wasser', color: '#2563eb', width: 3, layer: 'WASSER', aci: 5, icon: '💧' },
  abwasser: { label: 'Abwasser', color: '#7c3aed', width: 3, layer: 'ABWASSER', aci: 6, icon: '🚰' },
  drainage: { label: 'Drainage', color: '#0891b2', width: 3, layer: 'DRAINAGE', aci: 4, icon: '〰️' },
  kommunikation: { label: 'Kommunikation', color: '#16a34a', width: 3, layer: 'KOMMUNIKATION', aci: 3, icon: '📡' },
  leerrohr: { label: 'Leerrohr', color: '#ca8a04', width: 3, layer: 'LEERROHR', aci: 2, icon: '⭕' },
  gebaeude: { label: 'Gebäude', color: '#475569', width: 2, layer: 'GEBAEUDE', aci: 8, icon: '🏠' },
  schacht: { label: 'Schacht', color: '#111827', width: 2, layer: 'SCHACHT', aci: 7, icon: '⬛' },
  sonstiges: { label: 'Sonstiges', color: '#6b7280', width: 2, layer: 'SONSTIGES', aci: 9, icon: '📍' },
}

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as FeatureCategory[]

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  geplant: 'geplant',
  gebaut: 'gebaut',
  eingemessen: 'eingemessen',
  verworfen: 'verworfen',
}
export const FEATURE_STATUS_ORDER: FeatureStatus[] = ['geplant', 'gebaut', 'eingemessen', 'verworfen']

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  idee: 'Idee',
  geplant: 'geplant',
  bewilligt: 'bewilligt',
  im_bau: 'im Bau',
  abgeschlossen: 'abgeschlossen',
}
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['idee', 'geplant', 'bewilligt', 'im_bau', 'abgeschlossen']

/** Kategorie aus Name/Beschreibung erraten (KML-Import ohne Kategorie). */
export function guessCategory(name: string, description = ''): FeatureCategory {
  const t = `${name} ${description}`.toLowerCase()
  const rules: [RegExp, FeatureCategory][] = [
    // «Gülleleitung + Leerrohr»: Gülle zuerst (das Leerrohr wird als zweites Objekt ergänzt)
    [/gülle|guelle|jauche/, 'guelle'],
    [/leerrohr/, 'leerrohr'],
    [/drainage/, 'drainage'],
    [/abwasser|kanal/, 'abwasser'],
    [/strom|elektr|kabel/, 'strom'],
    [/wasser|hydrant/, 'wasser'],
    [/glasfaser|kommunikation|swisscom|telefon/, 'kommunikation'],
    [/schacht|verzweig/, 'schacht'],
    [/gebäude|gebaeude|haus|hof|stall|scheune/, 'gebaeude'],
  ]
  for (const [re, cat] of rules) if (re.test(t)) return cat
  return 'sonstiges'
}
