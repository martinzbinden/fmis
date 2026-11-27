// FMIS: öffnet vor einer AGFF-Seite den Store (agff/db/db.ts, Daten aus pglite) und zeigt bis dahin «lädt».
import { useEffect, useState, type ReactNode } from 'react'
import { getDb } from '../db/db'
import { errorText } from '@fmis/core/toast'
import JahrWahl from './JahrWahl'

let offen = false

/** `jahrWahl`: Leiste «Saison ‹ 2026 ›» über Seiten, die nach Jahr arbeiten (Jahr, Raster plus, Drucken, Fragen). */
export default function AgffSeite({ children, jahrWahl = false }: { children: ReactNode; jahrWahl?: boolean }) {
  const [bereit, setBereit] = useState(offen)
  const [fehler, setFehler] = useState<string | null>(null)
  useEffect(() => {
    if (bereit) return
    let weg = false
    getDb()
      .then(() => {
        offen = true
        if (!weg) setBereit(true)
      })
      .catch((e) => !weg && setFehler(errorText(e)))
    return () => {
      weg = true
    }
  }, [bereit])
  if (fehler) return <p className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Journal lässt sich nicht öffnen: {fehler}</p>
  if (!bereit) return <p className="p-4 text-sm text-gray-600">Journal wird geladen …</p>
  return (
    <div className="agff-journal">
      {jahrWahl && <JahrWahl />}
      {children}
    </div>
  )
}
