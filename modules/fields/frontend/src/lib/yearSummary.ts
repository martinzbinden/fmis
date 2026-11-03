// Jahresübersicht (core/frontend/src/yearSummary.ts): Flächen je Kultur und ÖLN-Fruchtfolge.
import { fmtNum, ranking, type YearFigure, type YearSection } from '@fmis/core/yearSummary'
import { getSyncedDb } from '../db/access'
import { classifyKultur, isGeholz } from './kulturCategory'
import { checkYear, cropInfo, cropLabel, type MainCrop } from './rotationRules'

export async function fieldsYearSummary(year: number): Promise<YearSection | null> {
  const pg = await getSyncedDb()
  const { rows } = await pg.query<MainCrop & { source: string }>(
    `select lineage_id, farm_id, jahr, kultur_code, kultur_name_de, area_a::float8 as area_a, sequence_in_year, source
     from field_declarations where deleted_at is null and jahr = $1`,
    [year],
  )
  const main = rows.filter((r) => r.sequence_in_year === 1)
  if (main.length === 0) return null
  const { rows: farms } = await pg.query<{ id: string; name: string }>('select id, name from farms where deleted_at is null order by name')

  let open = 0
  let kunstwiese = 0
  let dauer = 0
  const byCode = new Map<string, { ha: number; names: Map<string, number> }>()
  for (const r of main) {
    const a = Number(r.area_a ?? 0)
    const info = cropInfo(r.kultur_code, r.kultur_name_de)
    if (info.open) open += a
    else if (info.kunstwiese) kunstwiese += a
    else if (classifyKultur(r.kultur_code) === 'futter') dauer += a
    if (!isGeholz(r.kultur_code)) {
      // je Kulturcode zusammen (z.B. «Winterweizen» und «GiwR Winterweizen (BFF)»)
      const e = byCode.get(r.kultur_code) ?? { ha: 0, names: new Map<string, number>() }
      const label = cropLabel(r.kultur_name_de, r.kultur_code)
      e.ha += a / 100
      e.names.set(label, (e.names.get(label) ?? 0) + a)
      byCode.set(r.kultur_code, e)
    }
  }
  // Beschriftung: der Name mit der grössten Fläche
  const byCrop = new Map([...byCode.values()].map((e) => [[...e.names.entries()].sort((x, y) => y[1] - x[1])[0][0], e.ha] as [string, number]))
  const ha = (a: number) => `${fmtNum(a / 100, 1)} ha`
  const figures: YearFigure[] = [
    { label: 'Offene Ackerfläche', value: ha(open) },
    { label: 'Kunstwiese', value: ha(kunstwiese) },
    { label: 'Dauergrünland', value: ha(dauer), detail: 'Wiesen und Weiden' },
  ]
  for (const f of farms) {
    const c = checkYear(year, main.filter((r) => r.farm_id === f.id))
    if (c.arableHa === 0) continue
    const ok = c.culturesOk && c.shares.every((s) => s.ok)
    figures.push({
      label: `ÖLN-Fruchtfolge${farms.length > 1 ? ` ${f.name}` : ''}`,
      value: !c.applies ? 'unter 3 ha' : ok ? 'erfüllt ✓' : 'prüfen ⚠',
      detail: `${c.cultures} ${c.cultures === 1 ? 'Kultur' : 'Kulturen'}`,
    })
  }
  const planned = main.filter((r) => r.source === 'plan').length
  return {
    title: 'Kulturen',
    icon: '🗺️',
    to: '/fields/fruchtfolge',
    figures,
    charts: [{ title: 'Fläche je Kultur, ohne Gehölze', unit: 'ha', kind: 'ranking', data: ranking(byCrop, 10) }],
    note: planned ? `Davon ${planned} geplant (noch nicht deklariert).` : undefined,
  }
}
