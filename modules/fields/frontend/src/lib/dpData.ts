// Daten für die Direktzahlungen: Seite «Direktzahlungen» und Parzellen-Details auf der Karte.
import type { PGlite } from '@electric-sql/pglite'
import { DP_STORED_EMPTY, ratesFor, estimateFarm, referenceFor, resolveSettings, type DpParcel, type DpStatementLine, type DpStored } from './directPayments'

export type DpRow = DpParcel & { farm_id: string }

export interface DpSettingsRow {
  id: string
  farm_id: string
  jahr: number
  bio: boolean | null
  gmf: boolean | null
  rgve: number | null
  hang_18: number | null
  hang_35: number | null
  hang_50: number | null
  q2: string | null
}

export interface DpData {
  rows: DpRow[]
  farms: { id: string; name: string }[]
  settings: DpSettingsRow[]
  statement: (DpStatementLine & { farm_id: string; jahr: number })[]
}

/** Jahre mit Parzellen aus dem Raumdaten-Import bzw. mit eingefügter Abrechnung (Jahresauswahl). */
export async function loadDpYears(pg: PGlite): Promise<{ parcels: number[]; statement: number[] }> {
  const [a, b] = await Promise.all([
    pg.query<{ jahr: number }>(`select distinct jahr from field_declarations where deleted_at is null and sequence_in_year = 1 and source = 'import'`),
    pg.query<{ jahr: number }>('select distinct jahr from dp_statement_lines where deleted_at is null'),
  ])
  return { parcels: a.rows.map((r) => Number(r.jahr)), statement: b.rows.map((r) => Number(r.jahr)) }
}

export interface DpStatementRow extends DpStatementLine {
  id: string
}

/** Eingefügte Abrechnung eines Betriebs und Jahres, Zeile für Zeile (zum Ansehen und Löschen). */
export async function loadStatementLines(pg: PGlite, farmId: string, year: number): Promise<DpStatementRow[]> {
  const { rows } = await pg.query<DpStatementRow>(
    `select id, section, label, zone, quantity::float8 as quantity, rate::float8 as rate, factor::float8 as factor, amount::float8 as amount
     from dp_statement_lines where deleted_at is null and farm_id = $1 and jahr = $2 order by section, label, zone`,
    [farmId, year],
  )
  return rows
}

export async function loadDpData(pg: PGlite, year: number): Promise<DpData> {
  const { rows } = await pg.query<DpRow>(
    `select d.id, d.lineage_id, d.farm_id, d.flurname, d.kultur_code, d.kultur_name_de,
            d.area_a::float8 as area_a, d.baeume::float8 as baeume, mu.zone
     from field_declarations d
     left join management_units mu on mu.farm_id = d.farm_id and mu.external_id = d.management_unit_external_id
       and mu.jahr = d.jahr and mu.deleted_at is null
     where d.deleted_at is null and d.jahr = $1 and d.sequence_in_year = 1 and d.source = 'import'`,
    [year],
  )
  const { rows: farms } = await pg.query<{ id: string; name: string }>('select id, name from farms where deleted_at is null order by name')
  const { rows: settings } = await pg.query<DpSettingsRow>(
    `select id, farm_id, jahr, bio, gmf, rgve::float8 as rgve, hang_18::float8 as hang_18, hang_35::float8 as hang_35, hang_50::float8 as hang_50, q2
     from dp_settings where deleted_at is null and jahr <= $1 order by jahr desc, updated_at desc`,
    [year],
  )
  const { rows: statement } = await pg.query<DpStatementLine & { farm_id: string; jahr: number }>(
    `select farm_id, jahr, section, label, zone, quantity::float8 as quantity, rate::float8 as rate, factor::float8 as factor, amount::float8 as amount
     from dp_statement_lines where deleted_at is null and jahr <= $1`,
    [year],
  )
  return { rows, farms, settings, statement }
}

export function storedOf(row: DpSettingsRow | undefined): DpStored {
  if (!row) return DP_STORED_EMPTY
  let q2: Record<string, number> = {}
  try {
    q2 = JSON.parse(row.q2 ?? '{}') as Record<string, number>
  } catch {
    /* unlesbar: dann aus der Abrechnung */
  }
  return { bio: row.bio, gmf: row.gmf, rgve: row.rgve, hang: [row.hang_18, row.hang_35, row.hang_50], q2 }
}

/** Schätzung des ganzen Betriebs mit den gespeicherten Angaben (die jüngsten bis zu diesem Jahr).
 * Eine einzelne Parzelle hängt vom Betrieb ab: Flächenabstufung, Tierbesatz, Vernetzungsanteile.
 * Fehlen die Ansätze des Jahres, gelten die des nächstliegenden (`ratesYear`, anzeigen!). */
export function farmEstimate(data: DpData, farmId: string, year: number) {
  const { rates, ratesYear } = ratesFor(year)
  const parcels = data.rows.filter((r) => r.farm_id === farmId)
  const ref = referenceFor(data.statement, farmId, year)
  const settings = resolveSettings(storedOf(data.settings.find((s) => s.farm_id === farmId)), parcels, ref)
  return { estimate: estimateFarm(rates, parcels, settings, ref), settings, ref, ratesYear }
}
