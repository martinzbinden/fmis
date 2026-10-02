import { useCallback, useState } from 'react'
import { DEFAULT_THRESHOLDS, type CullingThresholds } from './culling'
import type { Species } from './fertility'

// Schwellen der Ausmerzliste je Instanz — reine Anzeige-Einstellung pro
// Gerät (localStorage, kein Sync), gleiches Muster wie die Spaltenwahl in
// components/AnimalTable.tsx.

function storageKey(moduleKey: string) {
  return `${moduleKey}_culling_thresholds`
}

function load(moduleKey: string, species: Species): CullingThresholds {
  const defaults = DEFAULT_THRESHOLDS[species]
  try {
    const raw = localStorage.getItem(storageKey(moduleKey))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<keyof CullingThresholds, unknown>>
      const merged = { ...defaults }
      for (const k of Object.keys(defaults) as (keyof CullingThresholds)[]) {
        const v = Number(parsed[k])
        if (parsed[k] != null && Number.isFinite(v)) merged[k] = v
      }
      return merged
    }
  } catch {
    // ohne localStorage gelten die Vorgaben
  }
  return defaults
}

export function useCullingThresholds(moduleKey: string, species: Species) {
  const [thresholds, setThresholds] = useState(() => load(moduleKey, species))
  const update = useCallback(
    (next: CullingThresholds) => {
      setThresholds(next)
      try {
        localStorage.setItem(storageKey(moduleKey), JSON.stringify(next))
      } catch {
        // nur bis zum Reload
      }
    },
    [moduleKey],
  )
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(moduleKey))
    } catch {
      // egal
    }
    setThresholds(DEFAULT_THRESHOLDS[species])
  }, [moduleKey, species])
  return { thresholds, update, reset }
}
