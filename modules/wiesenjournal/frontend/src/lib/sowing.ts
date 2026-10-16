// Saat: Umrechnung Saatmenge ↔ Saatstärke ↔ Pflanzen, Reihen (schema/0028).
//
// Saatstärke = KEIMFÄHIGE Körner/m² (wie in Sortenlisten/Merkblättern).
// Saatmenge (kg/ha) = Saatstärke × TKG (g) / Keimfähigkeit (%)
//   z.B. 350 Kö/m² × 45 g / 95 % = 165.8 kg/ha
// Pflanzen/m² (erwartet) = Saatstärke × Feldaufgang (%)
// Weite Reihe / Hasengasse: jede n-te Reihe geschlossen → die gleiche Menge
// verteilt sich auf weniger Reihen, je Reihenmeter liegen mehr Körner.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow, softDeleteRow } from '../db/write'

export interface SowingDetails {
  id: string
  variety: string | null
  tkg_g: number | null
  germination_pct: number | null
  seeds_m2: number | null
  emergence_pct: number | null
  row_spacing_cm: number | null
  wide_row_every: number | null
  notes: string | null
}

/** Formularstand (Texte) — gemeinsam für beide Tageseditoren. */
export interface SowingForm {
  variety: string
  tkg: string
  germination: string
  seeds: string
  kgHa: string
  emergence: string
  rowSpacing: string
  wideRowEvery: string
}

export const EMPTY_SOWING: SowingForm = {
  variety: '',
  tkg: '',
  germination: '',
  seeds: '',
  kgHa: '',
  emergence: '',
  rowSpacing: '',
  wideRowEvery: '',
}

export const parseNum = (v: string): number | null => {
  const t = v.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const pos = (v: number | null) => (v != null && v > 0 ? v : null)
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

/** Keimfähigkeit ohne Angabe = 100 %. */
const kf = (germinationPct: number | null) => pos(germinationPct) ?? 100

export function kgPerHaFromSeeds(seedsM2: number, tkgG: number, germinationPct: number | null): number {
  return round((seedsM2 * tkgG) / kf(germinationPct), 1)
}

export function seedsFromKgPerHa(kgHa: number, tkgG: number, germinationPct: number | null): number {
  return round((kgHa * kf(germinationPct)) / tkgG, 0)
}

/** Ausgesäte Körner/m² inkl. nicht keimfähiger. */
export function totalSeedsM2(seedsM2: number, germinationPct: number | null): number {
  return (seedsM2 * 100) / kf(germinationPct)
}

export function plantsM2(seedsM2: number, emergencePct: number | null): number | null {
  const e = pos(emergencePct)
  return e == null ? null : round((seedsM2 * e) / 100, 0)
}

/** Anteil gesäter Reihen: jede n-te geschlossen → (n-1)/n. */
export function sownFraction(wideRowEvery: number | null): number {
  return wideRowEvery != null && wideRowEvery >= 2 ? (wideRowEvery - 1) / wideRowEvery : 1
}

/** Körner je Meter gesäter Reihe (zum Nachzählen hinter der Sämaschine). */
export function seedsPerRowMeter(totalM2: number, rowSpacingCm: number, wideRowEvery: number | null): number {
  return round((totalM2 * (rowSpacingCm / 100)) / sownFraction(wideRowEvery), 0)
}

export function totalKg(kgHa: number, areaA: number): number {
  return round((kgHa * areaA) / 100, 1)
}

/** Nach einer Eingabe die abhängige Grösse nachführen. `changed` = das
 * Feld, das gerade bearbeitet wurde: Körner → kg/ha, kg/ha → Körner;
 * TKG/Keimfähigkeit → kg/ha aus den Körnern (wenn vorhanden), sonst
 * Körner aus kg/ha. Ohne TKG wird nichts umgerechnet (Mischungen). */
export function recalc(form: SowingForm, changed: keyof SowingForm): SowingForm {
  const tkg = pos(parseNum(form.tkg))
  if (tkg == null) return form
  const germ = parseNum(form.germination)
  const seeds = pos(parseNum(form.seeds))
  const kg = pos(parseNum(form.kgHa))
  if (changed === 'kgHa') return kg == null ? form : { ...form, seeds: String(seedsFromKgPerHa(kg, tkg, germ)) }
  if (changed === 'seeds' || ((changed === 'tkg' || changed === 'germination') && seeds != null)) {
    return seeds == null ? form : { ...form, kgHa: String(kgPerHaFromSeeds(seeds, tkg, germ)) }
  }
  if ((changed === 'tkg' || changed === 'germination') && kg != null) {
    return { ...form, seeds: String(seedsFromKgPerHa(kg, tkg, germ)) }
  }
  return form
}

/** Abgeleitete Kennzahlen für die Anzeige. */
export function sowingSummary(form: SowingForm, areaA: number | null) {
  const seeds = pos(parseNum(form.seeds))
  const germ = parseNum(form.germination)
  const kg = pos(parseNum(form.kgHa))
  const spacing = pos(parseNum(form.rowSpacing))
  const every = parseNum(form.wideRowEvery)
  const wide = every != null && every >= 2 ? Math.round(every) : null
  const total = seeds != null ? totalSeedsM2(seeds, germ) : null
  return {
    plants: seeds != null ? plantsM2(seeds, parseNum(form.emergence)) : null,
    perRowMeter: total != null && spacing != null ? seedsPerRowMeter(total, spacing, wide) : null,
    sownRowsPct: wide != null ? Math.round(sownFraction(wide) * 100) : null,
    totalKg: kg != null && areaA != null && areaA > 0 ? totalKg(kg, areaA) : null,
  }
}

export function formFromDetails(d: SowingDetails | null, kgHa: number | null): SowingForm {
  const s = (v: number | string | null | undefined) => (v == null ? '' : String(v))
  return {
    variety: s(d?.variety),
    tkg: s(d?.tkg_g),
    germination: s(d?.germination_pct),
    seeds: s(d?.seeds_m2),
    kgHa: s(kgHa),
    emergence: s(d?.emergence_pct),
    rowSpacing: s(d?.row_spacing_cm),
    wideRowEvery: s(d?.wide_row_every),
  }
}

function hasDetails(f: SowingForm): boolean {
  return [f.variety, f.tkg, f.germination, f.seeds, f.emergence, f.rowSpacing, f.wideRowEvery].some((v) => v.trim() !== '')
}

export async function loadSowing(pg: PGlite, usageEntryId: string): Promise<SowingDetails | null> {
  const { rows } = await pg.query<SowingDetails>('select * from sowing_details where id = $1 and deleted_at is null', [usageEntryId])
  const r = rows[0]
  if (!r) return null
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    ...r,
    tkg_g: n(r.tkg_g),
    germination_pct: n(r.germination_pct),
    seeds_m2: n(r.seeds_m2),
    emergence_pct: n(r.emergence_pct),
    row_spacing_cm: n(r.row_spacing_cm),
    wide_row_every: n(r.wide_row_every),
  }
}

/** Saatangaben zum Eintrag speichern; leere Angaben entfernen eine
 * bestehende Zeile (`existed`). */
export async function saveSowing(usageEntryId: string, form: SowingForm, existed: boolean): Promise<void> {
  if (!hasDetails(form)) {
    if (existed) await softDeleteRow('sowing_details', usageEntryId)
    return
  }
  const every = parseNum(form.wideRowEvery)
  await upsertRow('sowing_details', {
    id: usageEntryId,
    variety: form.variety.trim() || null,
    tkg_g: parseNum(form.tkg),
    germination_pct: parseNum(form.germination),
    seeds_m2: parseNum(form.seeds),
    emergence_pct: parseNum(form.emergence),
    row_spacing_cm: parseNum(form.rowSpacing),
    wide_row_every: every != null && every >= 2 ? Math.round(every) : null,
    notes: null,
  } as never)
}
