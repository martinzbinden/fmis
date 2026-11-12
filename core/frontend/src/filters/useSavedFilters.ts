import { useCallback, useMemo, useState } from 'react'
import { OPS_BY_TYPE, type FilterDef, type FilterMode } from './filterModel'

// Eigene Filter und welcher Filter wie wirkt: je Gerät im Browser (localStorage),
// wie die übrigen Anzeige-Einstellungen. Vorlagen der Seite kommen dazu und sind
// nicht änderbar.

export interface FilterState {
  custom: FilterDef[]
  modes: Record<string, FilterMode>
}

const EMPTY: FilterState = { custom: [], modes: {} }
const MODES: FilterMode[] = ['off', 'color', 'only']

const isCondition = (c: unknown): boolean => {
  const o = c as Record<string, unknown> | null
  return !!o && typeof o.field === 'string' && typeof o.op === 'string'
}

/** Gespeicherten Text lesen; Unlesbares wird weggelassen statt die Seite zu stören. */
export function parseFilterState(raw: string | null): FilterState {
  if (!raw) return EMPTY
  try {
    const data = JSON.parse(raw) as Partial<FilterState>
    const custom = (Array.isArray(data.custom) ? data.custom : []).filter(
      (f): f is FilterDef =>
        !!f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.color === 'string' && (f.match === 'all' || f.match === 'any') && Array.isArray(f.conditions) && f.conditions.every(isCondition),
    )
    const modes: Record<string, FilterMode> = {}
    for (const [id, m] of Object.entries(data.modes ?? {})) if (MODES.includes(m as FilterMode)) modes[id] = m as FilterMode
    return { custom: custom.map((f) => ({ ...f, preset: undefined })), modes }
  } catch {
    return EMPTY
  }
}

/** Nächster Zustand beim Antippen: aus → einfärben → nur zeigen → aus. */
export function nextMode(m: FilterMode | undefined): FilterMode {
  return m === 'color' ? 'only' : m === 'only' ? 'off' : 'color'
}

/** Eigene Filter + Vorlagen; `storageKey` je Seite und Modul, z.B. «dairy_board_filters». */
export function useSavedFilters(storageKey: string, presets: FilterDef[]) {
  const [state, setState] = useState<FilterState>(() => {
    try {
      return parseFilterState(localStorage.getItem(storageKey))
    } catch {
      return EMPTY
    }
  })

  const update = useCallback(
    (fn: (s: FilterState) => FilterState) => {
      setState((prev) => {
        const next = fn(prev)
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          // nur bis zum Neuladen
        }
        return next
      })
    },
    [storageKey],
  )

  const filters = useMemo(() => [...presets.map((p) => ({ ...p, preset: true })), ...state.custom], [presets, state.custom])

  return {
    filters,
    modes: state.modes,
    setMode: (id: string, mode: FilterMode) => update((s) => ({ ...s, modes: { ...s.modes, [id]: mode } })),
    cycle: (id: string) => update((s) => ({ ...s, modes: { ...s.modes, [id]: nextMode(s.modes[id]) } })),
    /** Neu oder ändern (nur eigene); ein neuer Filter ist gleich eingefärbt eingeschaltet. */
    save: (f: FilterDef) =>
      update((s) => {
        const exists = s.custom.some((c) => c.id === f.id)
        return {
          custom: exists ? s.custom.map((c) => (c.id === f.id ? { ...f, preset: undefined } : c)) : [...s.custom, { ...f, preset: undefined }],
          modes: exists ? s.modes : { ...s.modes, [f.id]: 'color' },
        }
      }),
    remove: (id: string) =>
      update((s) => {
        const { [id]: _gone, ...modes } = s.modes
        void _gone
        return { custom: s.custom.filter((c) => c.id !== id), modes }
      }),
    clearModes: () => update((s) => ({ ...s, modes: {} })),
  }
}

/** Für Tests und Vorlagen: eine Vorlage mit gültigen Operationen bauen. */
export function presetFilter(id: string, name: string, color: string, match: FilterDef['match'], conditions: FilterDef['conditions']): FilterDef {
  for (const c of conditions) if (!Object.values(OPS_BY_TYPE).some((ops) => ops.includes(c.op))) throw new Error(`Unbekannte Operation ${c.op}`)
  return { id, name, color, match, conditions, preset: true }
}
