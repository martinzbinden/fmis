import { useShowAcker, useShowSmall } from '../hooks/useShowAcker'
import ToggleSwitch from './ToggleSwitch'

/** Anzeige-Umschalter für Parzellen: Ackerkulturen und Miniflächen (< 5 a). */
export default function AckerToggle() {
  const [showAcker, setShowAcker] = useShowAcker()
  const [showSmall, setShowSmall] = useShowSmall()
  return (
    <>
      <ToggleSwitch checked={showAcker} onChange={setShowAcker} label="Ackerkulturen" />
      <ToggleSwitch checked={showSmall} onChange={setShowSmall} label="Miniflächen < 5 a" />
    </>
  )
}
