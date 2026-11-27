// Maschinen und Personen für die Suche über alles (core/frontend/src/search.ts).
import { textRank, type SearchHit } from '@fmis/core/search'
import { cachedMe } from '@fmis/core/auth'
import { getDb } from '../db/pglite'

/** Ziel eines Personen-Treffers: das Büro die Person in den Einstellungen, sonst ihre Abwesenheiten
 * (pages/Duty.tsx wertet `person` aus und markiert die Zeile bzw. filtert). */
export function personLink(id: string, office: boolean): string {
  return `/betrieb/dienste?tab=${office ? 'einstellungen' : 'abwesend'}&person=${encodeURIComponent(id)}`
}

export async function searchBetrieb(q: string): Promise<SearchHit[]> {
  const pg = await getDb()
  const [machines, people] = await Promise.all([
    pg.query<{ id: string; name: string; manufacturer: string | null; model: string | null; category: string | null; active: boolean }>(
      'select id, name, manufacturer, model, category, active from machines where deleted_at is null',
    ),
    pg.query<{ id: string; name: string; active: boolean }>('select id, name, active from duty_people where deleted_at is null'),
  ])
  const hits: SearchHit[] = []
  const office = cachedMe()?.permissions.includes('betrieb:dienste:write') ?? false
  for (const m of machines.rows) {
    const rank = textRank(q, m.name, m.manufacturer, m.model, m.category)
    if (rank == null) continue
    hits.push({ key: `m:${m.id}`, group: 'maschinen', title: m.name, subtitle: [m.manufacturer, m.model].filter(Boolean).join(' ') || undefined, icon: 'traktor', to: `/betrieb/maschinen/${m.id}`, rank: m.active ? rank : rank + 2 })
  }
  for (const p of people.rows) {
    const rank = textRank(q, p.name)
    if (rank == null) continue
    hits.push({ key: `p:${p.id}`, group: 'personen', title: p.name, subtitle: office ? 'Dienstplan · Einstellungen' : 'Dienstplan · Abwesenheiten', icon: 'person', to: personLink(p.id, office), rank: p.active ? rank : rank + 2 })
  }
  return hits
}
