import { useShowAcker } from '../hooks/useShowAcker'

export default function AckerToggle() {
  const [showAcker, setShowAcker] = useShowAcker()
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-600">
      <input type="checkbox" checked={showAcker} onChange={(e) => setShowAcker(e.target.checked)} className="h-3.5 w-3.5" />
      Ackerkulturen anzeigen
    </label>
  )
}
