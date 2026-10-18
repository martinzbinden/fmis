import { localTodayIso } from '@fmis/core/dates'
import type { PGlite } from '@electric-sql/pglite'
import { num } from './format'
import {
  DEFAULT_DIRECT_MARKETING,
  DEFAULT_MARKET_PRICES,
  type DirectMarketingSettings,
  type MarketPrices,
} from './marketing'

export interface MarketPricesRow extends MarketPrices {
  id: string | null
  valid_from: string | null
  source: string | null
}

export interface DirectMarketingRow extends DirectMarketingSettings {
  id: string | null
  valid_from: string | null
  butcher: string | null
}

export interface MarketingData {
  prices: MarketPricesRow
  direct: DirectMarketingRow
}

const PRICE_KEYS = ['la_t3', 'sm_t3', 'bio_premium', 'fee_per_animal'] as const
const DIRECT_KEYS = Object.keys(DEFAULT_DIRECT_MARKETING) as (keyof DirectMarketingSettings)[]

function numbers<K extends string>(row: Record<string, unknown>, keys: readonly K[], fallback: Record<K, number>) {
  const out = {} as Record<K, number>
  for (const k of keys) out[k] = num(row[k]) ?? fallback[k]
  return out
}

/**
 * Gültige Preise und Tarif zum Stichtag (jüngste Zeile mit valid_from <= Tag);
 * ohne erfasste Zeile die eingebauten Werte aus lib/marketing.ts.
 */
export async function loadMarketing(pg: PGlite, day?: string): Promise<MarketingData> {
  const at = day ?? localTodayIso()
  const { rows: p } = await pg.query<Record<string, unknown>>(
    `select * from market_prices where deleted_at is null and valid_from <= $1
     order by valid_from desc, updated_at desc limit 1`,
    [at],
  )
  const { rows: d } = await pg.query<Record<string, unknown>>(
    `select * from direct_marketing_settings where deleted_at is null and valid_from <= $1
     order by valid_from desc, updated_at desc limit 1`,
    [at],
  )
  const pr = p[0]
  const dr = d[0]
  return {
    prices: pr
      ? {
          ...numbers(pr, PRICE_KEYS, DEFAULT_MARKET_PRICES),
          id: String(pr.id),
          valid_from: String(pr.valid_from).slice(0, 10),
          source: (pr.source as string | null) ?? null,
        }
      : { ...DEFAULT_MARKET_PRICES, id: null, valid_from: null, source: 'Proviande Woche 42/2026 (eingebaut)' },
    direct: dr
      ? {
          ...numbers(dr, DIRECT_KEYS, DEFAULT_DIRECT_MARKETING),
          id: String(dr.id),
          valid_from: String(dr.valid_from).slice(0, 10),
          butcher: (dr.butcher as string | null) ?? null,
        }
      : { ...DEFAULT_DIRECT_MARKETING, id: null, valid_from: null, butcher: 'Schärer GmbH, Schwarzenburg (eingebaut)' },
  }
}
