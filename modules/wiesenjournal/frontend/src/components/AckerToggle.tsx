import { useShowAcker } from '../hooks/useShowAcker'
import ToggleSwitch from './ToggleSwitch'

export default function AckerToggle() {
  const [showAcker, setShowAcker] = useShowAcker()
  return <ToggleSwitch checked={showAcker} onChange={setShowAcker} label="Ackerkulturen" />
}
