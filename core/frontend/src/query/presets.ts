import { useCallback, useMemo, useState } from 'react'

// Filtervorschläge einer Liste: vorgefertigte (und eigene) Formeln für das Suchfeld, mit kurzer Beschriftung. Antippen:
// aus → einfärben (Treffer farbig) → nur zeigen (die Formel steht im Suchfeld, dort sichtbar und änderbar) → aus.
// Bearbeitet wird der Vorschlag selbst (keine Kopie); bei mitgelieferten gibt es «Vorgabe wiederherstellen».
// Je Gerät im Browser gespeichert (localStorage).

export interface QueryPreset {
  id: string
  /** voller Name (Tooltip, Bearbeiten) */
  name: string
  /** kurze Beschriftung des Knopfs, z.B. «Leer», «>6 J» */
  short: string
  /** Formel wie im Suchfeld, z.B. «Alter > 6 J» */
  formula: string
  /** Schlüssel aus FILTER_COLORS (core/filters/filterModel.ts) */
  color: string
  builtin?: boolean
}

type Editable = Pick<QueryPreset, 'name' | 'short' | 'formula' | 'color'>

interface PresetState {
  overrides: Record<string, Partial<Editable>>
  custom: QueryPreset[]
  colored: string[]
}
const EMPTY: PresetState = { overrides: {}, custom: [], colored: [] }

const SEP = /\s+und\s+|\s*&&?\s*|\s*;\s*/i

/** Teile einer Formel, klein und ohne Leerzeichen verglichen. */
export const formulaParts = (text: string): string[] =>
  text
    .split(SEP)
    .map((p) => p.trim())
    .filter(Boolean)

const sameKey = (p: string) => p.toLowerCase().replace(/\s+/g, '')

/** Stehen alle Teile der Formel im Text? */
export function formulaActive(text: string, formula: string): boolean {
  const have = new Set(formulaParts(text).map(sameKey))
  const need = formulaParts(formula)
  return need.length > 0 && need.every((p) => have.has(sameKey(p)))
}

export function addFormula(text: string, formula: string): string {
  if (formulaActive(text, formula)) return text
  const have = new Set(formulaParts(text).map(sameKey))
  return [...formulaParts(text), ...formulaParts(formula).filter((p) => !have.has(sameKey(p)))].join(' und ')
}

export function removeFormula(text: string, formula: string): string {
  const drop = new Set(formulaParts(formula).map(sameKey))
  return formulaParts(text)
    .filter((p) => !drop.has(sameKey(p)))
    .join(' und ')
}

function parseState(raw: string | null): PresetState {
  if (!raw) return EMPTY
  try {
    const d = JSON.parse(raw) as Partial<PresetState>
    const str = (v: unknown) => typeof v === 'string'
    const custom = (Array.isArray(d.custom) ? d.custom : []).filter((c): c is QueryPreset => !!c && str(c.id) && str(c.name) && str(c.short) && str(c.formula) && str(c.color))
    const overrides: PresetState['overrides'] = {}
    for (const [id, o] of Object.entries(d.overrides ?? {})) {
      const e: Partial<Editable> = {}
      for (const k of ['name', 'short', 'formula', 'color'] as const) if (str((o as Record<string, unknown>)?.[k])) e[k] = (o as Record<string, string>)[k]
      overrides[id] = e
    }
    return { overrides, custom: custom.map((c) => ({ ...c, builtin: undefined })), colored: (Array.isArray(d.colored) ? d.colored : []).filter(str) }
  } catch {
    return EMPTY
  }
}

export function usePresets(storage: string, builtins: QueryPreset[]) {
  const key = `${storage}_presets`
  const [state, setState] = useState<PresetState>(() => {
    try {
      return parseState(localStorage.getItem(key))
    } catch {
      return EMPTY
    }
  })
  const update = useCallback(
    (fn: (s: PresetState) => PresetState) =>
      setState((prev) => {
        const next = fn(prev)
        try {
          localStorage.setItem(key, JSON.stringify(next))
        } catch {
          // nur bis zum Neuladen
        }
        return next
      }),
    [key],
  )
  const presets = useMemo<QueryPreset[]>(() => [...builtins.map((b) => ({ ...b, ...state.overrides[b.id], builtin: true })), ...state.custom], [builtins, state])
  return {
    presets,
    colored: useMemo(() => new Set(state.colored), [state.colored]),
    setColored: (id: string, on: boolean) => update((s) => ({ ...s, colored: on ? [...new Set([...s.colored, id])] : s.colored.filter((x) => x !== id) })),
    /** Vorschlag ändern (mitgelieferte: als Abweichung, eigene: direkt) */
    edit: (id: string, patch: Editable) =>
      update((s) => (s.custom.some((c) => c.id === id) ? { ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : { ...s, overrides: { ...s.overrides, [id]: patch } })),
    add: (p: Editable) => {
      const id = `u-${Date.now().toString(36)}`
      update((s) => ({ ...s, custom: [...s.custom, { id, ...p }] }))
      return id
    },
    remove: (id: string) => update((s) => ({ ...s, custom: s.custom.filter((c) => c.id !== id), colored: s.colored.filter((x) => x !== id) })),
    reset: (id: string) =>
      update((s) => {
        const overrides = { ...s.overrides }
        delete overrides[id]
        return { ...s, overrides }
      }),
  }
}
