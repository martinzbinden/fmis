// Angaben aus importierten Leistungsausweisen (lib/importCertificate.ts) je
// Tier laden — für die Tierdetailseite und die Stammbaum-Ansicht.

import type { PGlite } from '@electric-sql/pglite'
import { isoDate, num } from './format'

export interface CertificateDetails {
  info: {
    color: string | null
    maedi_visna: string | null
    ccr5: string | null
    scrapie: string | null
    parasite_resistance: string | null
    offspring_male: number | null
    offspring_female: number | null
    offspring_total: number | null
    offspring_breeding: string | null
    document_date: string | null
  } | null
  breedingValues: { trait: string; value: number; reliability: number | null; eval_date: string }[]
  scores: {
    kind: 'punktierung' | 'lbe'
    score_date: string
    age_class: string | null
    format: number | null
    fundament: number | null
    udder: number | null
    teats: number | null
    wool: number | null
    total: number | null
    defects: string | null
    remarks: string | null
  }[]
  performance: {
    kind: 'laktation' | 'mittel' | 'lebensleistung' | 'toechter'
    lactation_number: number | null
    calving_date: string | null
    age: string | null
    test_type: string | null
    count: number | null
    interval_days: number | null
    days: number | null
    milk_kg: number | null
    fat_pct: number | null
    fat_kg: number | null
    protein_pct: number | null
    protein_kg: number | null
    cell_count: number | null
    persistency: number | null
  }[]
  /** Neuester Ausweis-Stand über alle Angaben. */
  document_date: string | null
}

const str = (v: unknown) => (v == null || v === '' ? null : String(v))

export async function loadCertificateDetails(pg: PGlite, key: string): Promise<CertificateDetails> {
  const [info, bvs, scores, perf] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from pedigree_info where deleted_at is null and animal_key = $1 order by updated_at desc limit 1', [key]),
    pg.query<Record<string, unknown>>(
      'select trait, value, reliability, eval_date from pedigree_breeding_values where deleted_at is null and animal_key = $1',
      [key],
    ),
    pg.query<Record<string, unknown>>('select * from conformation_scores where deleted_at is null and animal_key = $1 order by score_date desc', [key]),
    pg.query<Record<string, unknown>>(
      'select * from pedigree_performance where deleted_at is null and animal_key = $1 order by kind, lactation_number nulls last',
      [key],
    ),
  ])
  const i = info.rows[0]
  const dates = [...info.rows, ...scores.rows, ...perf.rows].map((r) => isoDate(r.document_date)).filter((d): d is string => !!d)
  return {
    info: i
      ? {
          color: str(i.color),
          maedi_visna: str(i.maedi_visna),
          ccr5: str(i.ccr5),
          scrapie: str(i.scrapie),
          parasite_resistance: str(i.parasite_resistance),
          offspring_male: num(i.offspring_male),
          offspring_female: num(i.offspring_female),
          offspring_total: num(i.offspring_total),
          offspring_breeding: str(i.offspring_breeding),
          document_date: isoDate(i.document_date),
        }
      : null,
    breedingValues: bvs.rows.map((b) => ({
      trait: String(b.trait),
      value: num(b.value)!,
      reliability: num(b.reliability),
      eval_date: isoDate(b.eval_date)!,
    })),
    scores: scores.rows.map((s) => ({
      kind: s.kind as 'punktierung' | 'lbe',
      score_date: isoDate(s.score_date)!,
      age_class: str(s.age_class),
      format: num(s.format),
      fundament: num(s.fundament),
      udder: num(s.udder),
      teats: num(s.teats),
      wool: num(s.wool),
      total: num(s.total),
      defects: str(s.defects),
      remarks: str(s.remarks),
    })),
    performance: perf.rows.map((p) => ({
      kind: p.kind as CertificateDetails['performance'][number]['kind'],
      lactation_number: num(p.lactation_number),
      calving_date: isoDate(p.calving_date),
      age: str(p.age),
      test_type: str(p.test_type),
      count: num(p.count),
      interval_days: num(p.interval_days),
      days: num(p.days),
      milk_kg: num(p.milk_kg),
      fat_pct: num(p.fat_pct),
      fat_kg: num(p.fat_kg),
      protein_pct: num(p.protein_pct),
      protein_kg: num(p.protein_kg),
      cell_count: num(p.cell_count),
      persistency: num(p.persistency),
    })),
    document_date: dates.sort().at(-1) ?? null,
  }
}

export function hasCertificateDetails(d: CertificateDetails): boolean {
  return !!(d.info || d.breedingValues.length || d.scores.length || d.performance.length)
}
