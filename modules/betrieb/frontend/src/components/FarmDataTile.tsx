import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import AppIcon from '@fmis/core/AppIcon'

/** Schmale Kachel auf der Übersicht (Maschinen & Betrieb): Betriebsdaten. */
export default function FarmDataTile() {
  const canRead = useHasPermission('betrieb:dienste:read')
  if (!canRead) return null
  return (
    <Link to="/betrieb/betriebsdaten" className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 text-sm shadow-sm first:mt-0 active:bg-gray-100">
      <AppIcon icon="beleg" size={36} />
      <span>
        <span className="block font-semibold text-gray-800">Betriebsdaten</span>
        <span className="block text-xs text-gray-500">Betriebsnummern, UID, BUR</span>
      </span>
    </Link>
  )
}
