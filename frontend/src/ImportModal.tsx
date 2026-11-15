import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import SidePanel from '@fmis/core/SidePanel'
import { openImportWith } from '@fmis/core/importModal'
import Upload from './pages/Upload'

/** Datenimport im Seitenfenster der Kopfzeile: man bleibt, wo man war. Einmal geöffnet bleibt der Import aufgebaut
 * und nur ausgeblendet, damit laufende Importe beim Schliessen im Hintergrund weitergehen. */
export default function ImportModal({ modules }: { modules: ModuleDescriptor[] }) {
  return (
    <SidePanel panel="import" title="📥 Daten importieren" wide keepMounted>
      <Upload modules={modules} inModal />
    </SidePanel>
  )
}

/** Alte Adresse /import (Lesezeichen, Links von aussen): Fenster öffnen und zur vorherigen Seite zurück, sonst zur
 * Startseite. */
export function ImportRoute() {
  const navigate = useNavigate()
  useEffect(() => {
    openImportWith({ survivesNavigation: true })
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/dashboard', { replace: true })
  }, [navigate])
  return null
}
