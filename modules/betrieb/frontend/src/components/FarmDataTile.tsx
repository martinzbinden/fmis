import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'

/** Schmale Kachel auf der Übersicht (Maschinen & Betrieb): Betriebsdaten. */
export default function FarmDataTile() {
  const canRead = useHasPermission('betrieb:dienste:read')
  if (!canRead) return null
  return (
    <Link to="/betrieb/betriebsdaten" className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 text-sm shadow-sm first:mt-0 active:bg-gray-100">
      <span className="text-2xl">📇</span>
      <span>
        <span className="block font-semibold text-gray-800">Betriebsdaten</span>
        <span className="block text-xs text-gray-500">Betriebsnummern, UID, BUR</span>
      </span>
    </Link>
  )
}
