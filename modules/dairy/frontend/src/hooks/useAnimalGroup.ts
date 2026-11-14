import { useEffect, useState } from 'react'
import { herdLocator, refreshHerdData } from '@fmis/core/animals'
import { localTodayIso } from '../lib/format'

/** Heutige Tiergruppe (Modul Tiere) eines Tiers; null ohne Gruppe. Erst lesen, nach dem Abgleich nochmals. */
export function useAnimalGroup(animalId: string | null | undefined): { id: string; name: string } | null {
  const [group, setGroup] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    if (!animalId) return
    let live = true
    const load = async () => {
      const gs = await herdLocator()?.groups?.(localTodayIso())
      if (!live || !gs) return
      const g = gs.find((x) => x.animalIds.includes(animalId))
      setGroup(g ? { id: g.id, name: g.name } : null)
    }
    void load().then(async () => {
      if (await refreshHerdData()) await load()
    })
    return () => {
      live = false
    }
  }, [animalId])
  return group
}
