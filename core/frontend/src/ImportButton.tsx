import { openImport, useImportModal } from './importModal'

/** 📥: öffnet den Datenimport als Fenster über der aktuellen Seite. Läuft im Hintergrund ein Import, pulsiert ein Punkt. */
export default function ImportButton({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  const { busy } = useImportModal()
  return (
    <button type="button" onClick={openImport} className={`relative ${className}`} title={busy ? 'Import läuft im Hintergrund — antippen zum Ansehen' : 'Daten importieren'} aria-label="Daten importieren">
      {children ?? '📥'}
      {busy && <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500 ring-2 ring-white" />}
    </button>
  )
}
