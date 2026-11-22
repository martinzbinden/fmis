// Fotos von Arbeiten aus dem Arbeitsplan (Modul Betrieb, schema 0015_photos) bei Stalljournal-Einträgen: der Eintrag
// trägt die Arbeit in ref_id. Nur die Angaben werden gelesen; Vorschauen lädt PhotoStrip erst beim Aufklappen.

import { useEffect, useState } from 'react'

export function useWorkPhotos(refIds: (string | null | undefined)[]): Map<string, string[]> {
  const [map, setMap] = useState<Map<string, string[]>>(new Map())
  const key = [...new Set(refIds.filter((x): x is string => !!x))].sort().join(',')
  useEffect(() => {
    if (!key) {
      setMap(new Map())
      return
    }
    let live = true
    void (async () => {
      try {
        const [{ getDb }, { photoIdsByRef }] = await Promise.all([import('@fmis/betrieb/db/pglite'), import('@fmis/betrieb/lib/photoRefs')])
        const m = await photoIdsByRef(await getDb(), key.split(','))
        if (live) setMap(m)
      } catch {
        // Modul Betrieb nicht aktiv oder noch nie geöffnet: keine Fotos
      }
    })()
    return () => {
      live = false
    }
  }, [key])
  return map
}
