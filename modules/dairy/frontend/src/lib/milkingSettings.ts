// Einstellungen der Milchwägung (Zahnrad-Menü, pages/Milchwaegung.tsx): Schrittweite der Knöpfe + und −, Sprung beim
// Gedrückthalten, Plätze je Bank. Je Gerät gemerkt (localStorage).

import { useSyncExternalStore } from 'react'
import type { Species } from './fertility'

export interface MilkingSettings {
  /** kg je Antippen von + oder − */
  step: number
  /** kg je Wiederholung beim Gedrückthalten */
  holdStep: number
  /** Plätze je Bank */
  capacity: number
}

export const DEFAULT_MILKING: Record<Species, MilkingSettings> = {
  sheep: { step: 0.1, holdStep: 0.2, capacity: 12 },
  cattle: { step: 0.1, holdStep: 1, capacity: 12 },
}

const listeners = new Set<() => void>()
const cache = new Map<string, MilkingSettings>()
const key = (moduleKey: string) => `${moduleKey}_milking_settings`

export function readMilkingSettings(moduleKey: string, species: Species): MilkingSettings {
  const hit = cache.get(moduleKey)
  if (hit) return hit
  const out = { ...DEFAULT_MILKING[species] }
  try {
    const raw = JSON.parse(localStorage.getItem(key(moduleKey)) ?? 'null') as Partial<Record<keyof MilkingSettings, unknown>> | null
    if (raw)
      for (const k of Object.keys(out) as (keyof MilkingSettings)[]) {
        const v = Number(raw[k])
        if (raw[k] != null && Number.isFinite(v) && v > 0) out[k] = k === 'capacity' ? Math.min(60, Math.round(v)) : v
      }
  } catch {
    // Vorgaben
  }
  cache.set(moduleKey, out)
  return out
}

export function saveMilkingSettings(moduleKey: string, s: MilkingSettings): void {
  cache.set(moduleKey, s)
  try {
    localStorage.setItem(key(moduleKey), JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
  listeners.forEach((l) => l())
}

export function useMilkingSettings(moduleKey: string, species: Species): MilkingSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => readMilkingSettings(moduleKey, species),
  )
}

/** Auf 0.01 kg runden (Gleitkomma). */
export const roundKg = (v: number) => Math.round(v * 100) / 100
