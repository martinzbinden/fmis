import type { SortField, SortState } from '../lib/parcelSort'

const FIELD_LABEL: Record<SortField, string> = { name: 'Name', area: 'Fläche', kultur: 'Kultur' }

/** Klickbare Mini-Titel für Name/Fläche/Kultur innerhalb der "Parzelle"-
 * Kopfzelle — sieht optisch wie eine Zelle aus, sortiert aber wie drei
 * eigene Spalten (siehe lib/parcelSort.ts). */
export default function ParcelHeaderSort({ sort, onSort }: { sort: SortState; onSort: (field: SortField) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {(['name', 'area', 'kultur'] as const).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onSort(f)}
          className={`text-[10px] font-semibold ${sort.field === f ? 'text-brand-700' : 'text-gray-400'}`}
          title={`Nach ${FIELD_LABEL[f]} sortieren`}
        >
          {FIELD_LABEL[f]}
          {sort.field === f && <span className="ml-0.5">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
        </button>
      ))}
    </div>
  )
}
