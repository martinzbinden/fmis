// Trockengestellt = neuester Journal-Eintrag 'trocken' liegt nach der letzten
// Geburt (eigene Geburtserfassung, Herdebuch-Laktationen oder Milchproben).
// Siehe schema/0012_dry_off.sql.

import type { PGlite } from '@electric-sql/pglite'

/** SQL-Bedingung "Tier <alias> ist trocken". */
export function isDrySql(alias = 'a'): string {
  return `exists (
    select 1 from animal_journal j
    where j.animal_id = ${alias}.id and j.deleted_at is null and j.category = 'trocken'
      and j.entry_date >= greatest(
        coalesce((select max(b.birth_date) from births b where b.dam_id = ${alias}.id and b.deleted_at is null), date '1900-01-01'),
        coalesce((select max(l.calving_date) from lactations l where l.animal_id = ${alias}.id and l.deleted_at is null), date '1900-01-01'),
        coalesce((select max(t.calving_date) from milk_tests t where t.animal_id = ${alias}.id and t.deleted_at is null), date '1900-01-01')
      ))`
}

export async function loadDryAnimalIds(pg: PGlite): Promise<Set<string>> {
  const { rows } = await pg.query<{ id: string }>(`select a.id from animals a where a.deleted_at is null and ${isDrySql('a')}`)
  return new Set(rows.map((r) => r.id))
}
