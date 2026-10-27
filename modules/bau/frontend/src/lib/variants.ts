// Varianten eines Projekts (schema/0004_variants.sql): Objekte mit variant_id = null gehören
// zu allen Varianten (Gebäude, Schächte, Anschlüsse), die übrigen zu genau einer.

import { CATEGORY_ORDER } from './categories'
import { lengthM, parseGeometry } from './geometry'
import type { BauFeature, FeatureCategory, Project, Variant } from '../types'

/** 'alle' = alles übereinander, sonst die id einer Variante. */
export type VariantView = 'alle' | string

export const inView = (f: Pick<BauFeature, 'variant_id'>, view: VariantView) => view === 'alle' || !f.variant_id || f.variant_id === view

/** Ansicht beim Öffnen: die gewählte Variante, sonst alles. */
export const defaultView = (p: Pick<Project, 'chosen_variant_id'> | null, variants: Variant[]): VariantView =>
  p?.chosen_variant_id && variants.some((v) => v.id === p.chosen_variant_id) ? p.chosen_variant_id : 'alle'

/** Fortlaufende Bezeichnung für eine neue Variante: A, B, C … */
export function nextVariantName(variants: Pick<Variant, 'name'>[]): string {
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i)
    if (!variants.some((v) => v.name.trim().toUpperCase() === c || v.name.trim().toUpperCase().startsWith(`${c}:`))) return c
  }
  return `Variante ${variants.length + 1}`
}

export interface VariantSummary {
  id: string
  name: string
  /** Leitungslänge je Kategorie in m (gemeinsame + eigene Objekte, ohne verworfene) */
  lengths: Partial<Record<FeatureCategory, number>>
  total: number
  own: number
}

/** Vergleich der Varianten: Längen je Kategorie, gemeinsame Objekte zählen bei jeder Variante mit. */
export function compareVariants(features: BauFeature[], variants: Variant[]): { rows: VariantSummary[]; categories: FeatureCategory[] } {
  const live = features.filter((f) => f.status !== 'verworfen')
  const rows = variants.map((v) => {
    const mine = live.filter((f) => inView(f, v.id))
    const lengths: Partial<Record<FeatureCategory, number>> = {}
    for (const f of mine) {
      const g = parseGeometry(f.geometry)
      if (g?.type !== 'LineString') continue
      lengths[f.category] = (lengths[f.category] ?? 0) + (lengthM(g) ?? 0)
    }
    return { id: v.id, name: v.name, lengths, total: Object.values(lengths).reduce((a, b) => a + (b ?? 0), 0), own: mine.filter((f) => f.variant_id === v.id).length }
  })
  const categories = CATEGORY_ORDER.filter((c) => rows.some((r) => r.lengths[c]))
  return { rows, categories }
}
