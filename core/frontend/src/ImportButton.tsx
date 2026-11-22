import { closeImport, openImport, useImportModal } from './importModal'
import AppIcon from './AppIcon'

/** 📥: klappt den Datenimport als Seitenfenster auf und zu. Läuft im Hintergrund ein Import, pulsiert ein Punkt. */
export default function ImportButton({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  const { busy, open } = useImportModal()
  const label = busy ? 'Daten importieren – Import läuft im Hintergrund' : 'Daten importieren'
  return (
    <button
      type="button"
      onClick={() => (open ? closeImport() : openImport())}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={`relative ${open ? 'bg-gray-200' : ''} ${className}`}
      title={label}
      aria-label={label}
    >
      {children ?? <AppIcon icon="import" size={30} />}
      {busy && <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500 ring-2 ring-white" />}
    </button>
  )
}
