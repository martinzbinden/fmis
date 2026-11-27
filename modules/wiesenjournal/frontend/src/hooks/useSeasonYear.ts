// Saison der klassischen Seiten (Raster, Journal, Parzellen, Auswertung, Karte): aus `?jahr=` in der Adresse,
// sonst das laufende Jahr. So führen Links (z. B. «Details» der Jahresübersicht) ins richtige Jahr, und die Wahl
// bleibt beim Neuladen erhalten.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from './useQuery'
import { CURRENT_YEAR, parseSeasonYear, seasonYearOptions } from '../lib/seasonYear'

export { CURRENT_YEAR }

export function useSeasonYear(): [number, (y: number) => void] {
  const [params, setParams] = useSearchParams()
  const year = parseSeasonYear(params.get('jahr')) ?? CURRENT_YEAR
  const setYear = useCallback(
    (y: number) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          if (y === CURRENT_YEAR) next.delete('jahr')
          else next.set('jahr', String(y))
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  return [year, setYear]
}

/** Saisons, für die es Parzellen gibt (pglite). */
export function useSeasonYears(selected: number): number[] {
  const { data } = useQuery(
    async (pg) => (await pg.query<{ y: number }>('select distinct season_year as y from parcels where deleted_at is null')).rows.map((r) => Number(r.y)),
    [],
  )
  return seasonYearOptions(data ?? [], CURRENT_YEAR, selected)
}
