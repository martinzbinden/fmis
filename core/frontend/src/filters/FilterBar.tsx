import { colorOf, describeFilter, type FieldDef, type FilterDef, type FilterMode } from './filterModel'

/** Filterleiste: ein Knopf je Filter (antippen: aus → einfärben → nur zeigen → aus), Stift zum
 * Bearbeiten, «+ Filter» für einen neuen. `counts` = Treffer je Filter-ID. */
export default function FilterBar<R>({
  filters,
  modes,
  counts,
  fields,
  onCycle,
  onEdit,
  onNew,
  onClear,
}: {
  filters: FilterDef[]
  modes: Record<string, FilterMode>
  counts: Record<string, number>
  fields: FieldDef<R>[]
  onCycle: (id: string) => void
  onEdit: (f: FilterDef) => void
  onNew: () => void
  onClear: () => void
}) {
  const active = filters.filter((f) => (modes[f.id] ?? 'off') !== 'off').length
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter">
      {filters.map((f) => {
        const mode = modes[f.id] ?? 'off'
        const c = colorOf(f.color)
        const state = mode === 'color' ? 'einfärben' : mode === 'only' ? 'nur diese zeigen' : 'aus'
        return (
          <span key={f.id} className="inline-flex items-stretch">
            <button
              type="button"
              onClick={() => onCycle(f.id)}
              title={`${describeFilter(f, fields)} — ${state}. Antippen: ${mode === 'off' ? 'einfärben' : mode === 'color' ? 'nur diese zeigen' : 'ausschalten'}`}
              aria-label={`${f.name}, ${counts[f.id] ?? 0} Treffer, ${state}`}
              className={`flex min-h-11 items-center gap-1.5 rounded-l-full border px-3 text-sm ${
                mode === 'off' ? 'border-gray-300 bg-white text-gray-700' : `${c.chip} font-semibold`
              } ${mode === 'only' ? 'ring-2 ring-gray-800' : ''}`}
            >
              <span className={`h-3 w-3 shrink-0 rounded-full ${c.dot}`} />
              <span>{f.name}</span>
              <span className="text-xs opacity-70">{counts[f.id] ?? 0}</span>
              {mode === 'only' && <span className="text-xs font-bold">nur</span>}
            </button>
            <button
              type="button"
              onClick={() => onEdit(f)}
              aria-label={f.preset ? `${f.name} als Kopie bearbeiten` : `${f.name} bearbeiten`}
              className="grid min-h-11 w-9 place-items-center rounded-r-full border border-l-0 border-gray-300 bg-white text-sm text-gray-600 active:bg-gray-100"
            >
              ✏️
            </button>
          </span>
        )
      })}
      <button type="button" onClick={onNew} className="min-h-11 rounded-full border border-dashed border-gray-400 px-3 text-sm font-medium text-gray-700">
        + Filter
      </button>
      {active > 0 && (
        <button type="button" onClick={onClear} className="min-h-11 rounded-full px-3 text-sm text-gray-600 underline">
          alle ausschalten
        </button>
      )}
    </div>
  )
}
