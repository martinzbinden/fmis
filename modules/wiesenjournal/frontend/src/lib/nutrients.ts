import { num } from './format'
import type { FertilizerType } from '../types'

// Zwilling von backend/app/nutrients.py — keep in sync!
// Menge × Gehalt je Einheit der Düngerart; bei Gülle skaliert der
// Verdünnungsfaktor (Gülle-Anteil im ausgebrachten Volumen) relativ zum
// Default der Düngerart: RGv-Werte gelten für 1:1 (0.5) — wird 3:1 (0.75)
// ausgebracht, ist pro m³ 1.5× so viel drin.

export interface Nutrients {
  n_kg: number | null
  n_avail_kg: number | null
  p2o5_kg: number | null
  k2o_kg: number | null
}

/** '3:1' (Gülle:Wasser) → 0.75; '1:1' → 0.5; leer/unlesbar → null. */
export function parseDilution(text: string | null | undefined): number | null {
  if (!text) return null
  const parts = text.replace(/\s/g, '').split(':')
  if (parts.length !== 2) return null
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (Number.isNaN(a) || Number.isNaN(b) || a + b <= 0) return null
  return a / (a + b)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function computeNutrients(
  amount: number | null,
  type: FertilizerType | null,
  dilutionFactor: number | null,
): Nutrients {
  if (amount == null || !type) return { n_kg: null, n_avail_kg: null, p2o5_kg: null, k2o_kg: null }
  const dflt = num(type.dilution_default) || 1
  const scale = dilutionFactor ? dilutionFactor / dflt : 1
  const eff = amount * scale
  const nKg = eff * (num(type.n_kg_per_unit) ?? 0)
  return {
    n_kg: round2(nKg),
    n_avail_kg: round2((nKg * (num(type.n_avail_pct) ?? 0)) / 100),
    p2o5_kg: round2(eff * (num(type.p2o5_kg_per_unit) ?? 0)),
    k2o_kg: round2(eff * (num(type.k2o_kg_per_unit) ?? 0)),
  }
}

/** kg/ha aus kg und Aren (100 a = 1 ha). */
export function kgPerHa(kg: number | null | undefined, areaA: number | null | undefined): number | null {
  if (kg == null || !areaA) return null
  return round2((kg / areaA) * 100)
}
