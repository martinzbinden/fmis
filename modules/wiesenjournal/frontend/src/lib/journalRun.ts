import type { UsageEntry } from '../types'

export interface UsageBar {
  startIdx: number
  span: number
  entry: UsageEntry
}

function usageSignature(e: UsageEntry): string {
  // is_planned Teil der Signatur: ein Plan neben einem inhaltlich gleichen
  // definitiven Eintrag soll NICHT verschmelzen, sonst verschwindet dessen
  // auffälliger Rahmen im gemeinsamen Balken (siehe JournalGridClassic.tsx).
  return `${e.usage_type}|${e.animal_category ?? ''}|${e.day_only ? 1 : 0}|${e.label ?? ''}|${e.is_planned ? 1 : 0}`
}

export function sameUsageRun(a: UsageEntry, b: UsageEntry): boolean {
  return usageSignature(a) === usageSignature(b)
}

/** Fasst aufeinanderfolgende Tage mit "gleichem" Nutzungseintrag zu einem
 * Balken zusammen (fürs Klassisch-Raster, components/JournalGridClassic.tsx)
 * — z.B. 4 Tage Weide/Kühe als ein Balken statt vier Einzelzellen. Ein Tag
 * ohne (oder mit abweichendem) Eintrag bricht die Reihe. Mehrere Einträge an
 * einem Tag: nur der erste zählt (der Klassisch-Editor erfasst ohnehin nur
 * einen Nutzungseintrag pro Tag). */
export function groupUsageRuns(days: string[], usageByDate: Record<string, UsageEntry[] | undefined>): UsageBar[] {
  const bars: UsageBar[] = []
  let i = 0
  while (i < days.length) {
    const entry = usageByDate[days[i]]?.[0]
    if (!entry) {
      i++
      continue
    }
    let j = i + 1
    while (j < days.length) {
      const next = usageByDate[days[j]]?.[0]
      if (!next || !sameUsageRun(entry, next)) break
      j++
    }
    bars.push({ startIdx: i, span: j - i, entry })
    i = j
  }
  return bars
}

/** Findet den Balken, der genau bei `days[0]` beginnt (Klassisch-Raster
 * ruft den Editor immer mit dem ersten Tag eines Balkens auf — Folgetage
 * eines laufenden Balkens haben keinen eigenen Klick-Button, siehe
 * JournalGridClassic.tsx). Kein Eintrag an diesem Tag: null. */
export function findRunAt(days: string[], usageByDate: Record<string, UsageEntry[] | undefined>): UsageBar | null {
  const bars = groupUsageRuns(days, usageByDate)
  return bars.find((b) => b.startIdx === 0) ?? null
}
