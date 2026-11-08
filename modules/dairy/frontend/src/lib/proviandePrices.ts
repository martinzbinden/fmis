// Proviande-Wochenpreise für Erlös-Rechnungen (Gruppen, Lämmer zum Schlachttermin): der
// Server holt sie automatisch, sie liegen in der Ablage des Mastplaners (livestock).

import { useEffect, useState } from 'react'
import { latestProviande } from '@fmis/livestock/lib/proviande'

export interface ProviandePrices {
  week: string
  validFrom: string
  /** Jungtier: Lämmer LA T3 bzw. Kälber KV T3, CHF/kg SG */
  young: number | null
  /** ausgewachsen: Schafe SM T3 bzw. Kühe VK T3, CHF/kg SG */
  adult: number | null
  youngLabel: string
  adultLabel: string
}

export function useProviandePrices(species: 'sheep' | 'cattle'): ProviandePrices | null {
  const [prices, setPrices] = useState<ProviandePrices | null>(null)
  useEffect(() => {
    let live = true
    const [y, a] = species === 'sheep' ? ['LA', 'SM'] : ['KV', 'VK']
    const load = () =>
      latestProviande().then((w) => {
        if (live && w) setPrices({ week: w.week, validFrom: w.validFrom, young: w.prices[`${y} T`]?.sg ?? null, adult: w.prices[`${a} T`]?.sg ?? null, youngLabel: `${y} T3`, adultLabel: `${a} T3` })
      })
    void load()
    // beim ersten Öffnen kommen die Preise erst mit dem Abgleich des Mastplaners
    const t = setTimeout(() => void load(), 15_000)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [species])
  return prices
}
