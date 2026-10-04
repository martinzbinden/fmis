import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'

/** Kachel auf der Übersicht: Fahrhilfe (GPS-Tracking mit Parallelfahren). */
export default function DriveAssistTile() {
  const canTrack = useHasPermission('wiesenjournal:tracking:write')
  if (!canTrack) return null
  return (
    <Link to="/wiesenjournal/karte?fahrhilfe=1" className="mt-4 flex items-center gap-3 rounded-xl bg-white p-4 text-sm shadow-sm active:bg-gray-100">
      <span className="text-3xl">🧭</span>
      <span>
        <span className="block font-semibold text-gray-800">Fahrhilfe starten</span>
        <span className="block text-xs text-gray-500">Parallelfahren, Gülle (Fass/Verschlauchung), Kalk, Säen, Striegeln</span>
      </span>
    </Link>
  )
}
