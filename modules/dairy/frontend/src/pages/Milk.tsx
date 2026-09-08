import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, fmtKg, fmtPct } from '../lib/format'
import { selectYogurtCows, TARGET_PROTEIN_PCT, type YogurtSelectionResult } from '../lib/yogurtSelection'
import type { AnimalMilkCurrent } from '../types'

type SortKey = 'name' | 'test_date' | 'milk_kg' | 'fat_kg' | 'protein_kg' | 'protein_pct'

async function loadCurrentMilk(pg: PGlite): Promise<AnimalMilkCurrent[]> {
  const { rows } = await pg.query<AnimalMilkCurrent>(
    `select * from v_animal_milk_current where status = 'aktiv' order by protein_pct desc`,
  )
  return rows
}

export default function Milk() {
  const { data, loading } = useQuery(loadCurrentMilk)
  const cows = data ?? []
  const [sortKey, setSortKey] = useState<SortKey>('protein_pct')
  const [sortDesc, setSortDesc] = useState(true)
  const [selection, setSelection] = useState<YogurtSelectionResult | null>(null)

  const sorted = useMemo(() => {
    const copy = [...cows]
    copy.sort((a, b) => {
      const av = sortKey === 'name' ? (a.name ?? a.ear_tag) : a[sortKey]
      const bv = sortKey === 'name' ? (b.name ?? b.ear_tag) : b[sortKey]
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDesc ? -cmp : cmp
    })
    return copy
  }, [cows, sortKey, sortDesc])

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const selectedIds = useMemo(
    () => new Set(selection?.selected.map((c) => c.animal_id) ?? []),
    [selection],
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Milch</h1>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && cows.length === 0 && (
        <p className="text-center text-gray-500">
          Keine aktuellen Milchtests. Zuerst unter "Kühe" den Herdebuch-Export importieren.
        </p>
      )}

      {cows.length > 0 && (
        <>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Joghurt-Kuhauswahl</h2>
                <p className="text-xs text-gray-500">
                  Grösstmögliche Milchmenge mit gewichtetem Ø-Eiweiss ≥ {TARGET_PROTEIN_PCT}%.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelection(selectYogurtCows(cows))}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white active:bg-brand-800"
              >
                Joghurt-Kühe vorschlagen
              </button>
            </div>
            {selection && (
              <div className="mt-3 rounded bg-brand-50 p-3 text-sm text-brand-900">
                {selection.selected.length === 0 ? (
                  <p>Keine Kuh erreicht allein {TARGET_PROTEIN_PCT}% Eiweiss — keine Auswahl möglich.</p>
                ) : (
                  <p>
                    {selection.selected.length} Kühe ausgewählt · {fmtKg(selection.totalMilkKg)} Milch ·
                    gewichteter Ø-Eiweiss {fmtPct(selection.weightedProteinPct)}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <Th label="Kuh" active={sortKey === 'name'} onClick={() => handleSort('name')} />
                  <Th
                    label="Testdatum"
                    active={sortKey === 'test_date'}
                    onClick={() => handleSort('test_date')}
                  />
                  <Th label="Milch" active={sortKey === 'milk_kg'} onClick={() => handleSort('milk_kg')} />
                  <Th
                    label="kg Fett"
                    active={sortKey === 'fat_kg'}
                    onClick={() => handleSort('fat_kg')}
                    emphasize
                  />
                  <Th
                    label="kg Eiweiss"
                    active={sortKey === 'protein_kg'}
                    onClick={() => handleSort('protein_kg')}
                    emphasize
                  />
                  <Th
                    label="% Eiweiss"
                    active={sortKey === 'protein_pct'}
                    onClick={() => handleSort('protein_pct')}
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.animal_id}
                    className={`border-b last:border-0 ${
                      selectedIds.has(c.animal_id) ? 'bg-brand-50' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-gray-800">{c.name ?? c.ear_tag}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtDate(c.test_date)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtKg(c.milk_kg)}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(c.fat_kg)}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(c.protein_kg)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtPct(c.protein_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Th({
  label,
  active,
  onClick,
  emphasize,
}: {
  label: string
  active: boolean
  onClick: () => void
  emphasize?: boolean
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-3 py-2 font-medium active:bg-gray-100 ${
        active ? 'text-brand-700' : ''
      } ${emphasize ? 'font-semibold' : ''}`}
    >
      {label}
      {active ? ' ▾' : ''}
    </th>
  )
}
