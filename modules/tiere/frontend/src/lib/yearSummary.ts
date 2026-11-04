// Jahresübersicht (core/frontend/src/yearSummary.ts): Weide und Auslauf der Tiergruppen.
import { fmtNum, MONTHS, ranking, type YearSection } from '@fmis/core/yearSummary'
import { todayIso } from './format'
import { loadHerdData } from './herds'
import { accessIndex, groupYear } from './outdoorAccess'

export async function tiereYearSummary(year: number): Promise<YearSection | null> {
  const data = await loadHerdData()
  const idx = accessIndex(data)
  const today = todayIso()
  if (`${year}-01-01` > today) return null
  const monthly = new Array(12).fill(0) as number[]
  const byGroup = new Map<string, number>()
  let months = 0
  let met = 0
  for (const g of data.groups) {
    const usage = groupYear(idx, g.id, year, today)
    if (usage.every((u) => u.present === 0)) continue
    usage.forEach((u, i) => (monthly[i] += u.animalWeideDays))
    byGroup.set(g.name, usage.reduce((s, u) => s + u.weide, 0))
    // nur abgeschlossene Monate zählen für «erfüllt»
    for (const u of usage) {
      if (!u.counter || u.month >= today.slice(0, 7)) continue
      months++
      if (u.counter.state === 'erfuellt') met++
    }
  }
  if (byGroup.size === 0) return null
  const total = monthly.reduce((s, v) => s + v, 0)
  return {
    title: 'Tiergruppen: Weide und Auslauf',
    icon: '🐾',
    to: `/tiere/weide?jahr=${year}`,
    figures: [
      { label: 'Tier-Weidetage', value: fmtNum(total), detail: 'Tiere × Tage auf der Weide' },
      { label: 'RAUS-Monate erfüllt', value: months ? `${met} von ${months}` : '–', detail: 'Gruppen × abgeschlossene Monate' },
    ],
    charts: [
      { title: 'Tier-Weidetage je Monat', unit: 'Tier-Tage', kind: 'months', data: MONTHS.map((name, i) => ({ name, value: monthly[i] })) },
      { title: 'Weidetage je Gruppe', unit: 'Tage', kind: 'ranking', data: ranking(byGroup, 8) },
    ],
    note: 'Aus den Aufenthalten der Gruppen (Weide) und den Tierzahlen.',
  }
}
