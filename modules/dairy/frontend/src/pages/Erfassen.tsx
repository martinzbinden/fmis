import { useMemo, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { readRecent } from '@fmis/core/search'
import { itemPath, menuItems, type MenuItem } from '../lib/menuItems'
import { openImport } from '@fmis/core/importModal'
import { speciesOf } from '../lib/species'
import { useQuery } from '../hooks/useQuery'
import { loadPendingOffspring } from '../lib/earTagPending'
import { loadTvdBirths, reportable } from '../lib/tvdBirths'
import { loadLambs, WEAN_FROM_DAYS } from '../lib/lambs'
import { localTodayIso } from '../lib/format'

export default function Erfassen({ moduleKey }: { moduleKey: string }) {
  const sheep = speciesOf(moduleKey) === 'sheep'
  const pending = useQuery(loadPendingOffspring).data?.length ?? 0
  const tvdOpen = useQuery((pg) => loadTvdBirths(pg, '2000-01-01')).data?.reduce((n, b) => n + reportable(b).length, 0) ?? 0
  const weanDue = useQuery((pg) => loadLambs(pg, localTodayIso())).data?.filter((l) => l.nursing && l.ageDays >= WEAN_FROM_DAYS).length ?? 0
  const items = useMemo(() => menuItems(sheep, WEAN_FROM_DAYS).sort((a, b) => a.label.localeCompare(b.label, 'de')), [sheep])
  // die zwei zuletzt geöffneten Funktionen dieses Moduls (core/search.ts recordRecent, gesetzt von der Kopfzeile)
  const recent = useMemo(() => {
    const out: MenuItem[] = []
    for (const r of readRecent()) {
      const item = items.find((i) => !i.to.includes('?') && itemPath(moduleKey, i.to) === r.path)
      if (item && !out.includes(item)) out.push(item)
      if (out.length === 2) break
    }
    return out
  }, [items, moduleKey])
  const badge = (to: string) => (to === 'ohrmarken' ? pending : to === 'tvd' ? tvdOpen : to.startsWith('laemmer?aktion=absetzen') ? weanDue : 0)
  const href = (to: string) => (to.startsWith('/') ? to : `../${to}`)
  const onImport = (to: string) => (to === '/import' ? (e: MouseEvent) => (e.preventDefault(), openImport()) : undefined)
  return (
    <div className="mx-auto max-w-lg space-y-3 p-4 pb-24">
      <h1 className="mb-2 text-xl font-bold text-gray-800">Mehr</h1>
      {recent.length > 0 && (
        <section aria-label="Zuletzt benutzt" className="grid grid-cols-2 gap-3">
          {recent.map((item) => (
            <Link
              key={item.to}
              to={href(item.to)}
              relative="path"
              onClick={onImport(item.to)}
              className="relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl bg-brand-50 p-3 shadow-sm ring-1 ring-brand-200 active:bg-brand-100"
            >
              <span className="text-3xl" aria-hidden>
                {item.icon}
              </span>
              <span className="text-base font-semibold text-gray-900">{item.short}</span>
              {badge(item.to) > 0 && <span className="absolute right-2 top-2 rounded-full bg-amber-700 px-2 py-0.5 text-sm font-bold text-white">{badge(item.to)}</span>}
            </Link>
          ))}
        </section>
      )}
      {items.map((item) => (
        <Link
          key={item.to}
          to={href(item.to)}
          relative="path"
          // Datenimport als Fenster über dieser Seite, statt die Seite zu verlassen
          onClick={onImport(item.to)}
          className="flex items-center gap-4 rounded-xl bg-white p-4 shadow-sm active:bg-gray-50"
        >
          <span className="text-3xl" aria-hidden>
            {item.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-gray-800">{item.label}</span>
            <span className="block text-sm text-gray-600">{item.desc}</span>
          </span>
          {badge(item.to) > 0 && (
            <span className="shrink-0 rounded-full bg-amber-700 px-2.5 py-1 text-sm font-bold text-white" aria-label={`${badge(item.to)} offen`}>
              {badge(item.to)}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
