// Proviande-Wochenpreise (schema/0006, vom Server automatisch geholt: backend/app/proviande.py).
// Auch für andere Module (Milchvieh: Gruppenvergleich, Lämmer zum Schlachttermin).

import type { PGlite } from '@electric-sql/pglite'
import { localTodayIso } from '@fmis/core/dates'
import { getSyncedDb } from '../db/access'
import { num } from './format'

export interface ProviandeWeek {
  week: string
  validFrom: string
  /** Schlüssel «Kategorie Fleischigkeit», z.B. «LA T» (Fettklasse 3) */
  prices: Record<string, { sg: number | null; lg: number | null }>
}

/** Jüngste Woche bis eine Woche nach `day`: Proviande veröffentlicht am Donnerstag die Preise
 * ab dem folgenden Montag, und für die Planung zählt die neueste. null ohne Daten. */
export async function loadProviande(pg: PGlite, day: string = localTodayIso()): Promise<ProviandeWeek | null> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select * from proviande_prices where deleted_at is null and valid_from = (
       select max(valid_from) from proviande_prices where deleted_at is null and valid_from <= $1::date + 7)`,
    [day],
  )
  if (!rows.length) return null
  const prices: ProviandeWeek['prices'] = {}
  for (const r of rows) prices[`${r.category} ${r.fleshiness}`] = { sg: num(r.price_sg), lg: num(r.price_lg) }
  const v = rows[0].valid_from
  return { week: String(rows[0].week), validFrom: v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10), prices }
}

/** Aus einem anderen Modul: öffnet die Ablage des Mastplaners (null, wenn nicht erreichbar). */
export async function latestProviande(day?: string): Promise<ProviandeWeek | null> {
  try {
    return await loadProviande(await getSyncedDb(), day)
  } catch (e) {
    // z.B. ohne Recht auf den Mastplaner: dann gelten die eigenen Preise
    console.warn('Proviande-Preise nicht lesbar', e)
    return null
  }
}
