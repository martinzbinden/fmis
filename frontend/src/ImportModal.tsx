import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { closeImport, openImport, useImportModal } from '@fmis/core/importModal'
import Upload from './pages/Upload'

/** Datenimport als Fenster über der aktuellen Seite: man bleibt, wo man war. Einmal geöffnet bleibt der Import
 * aufgebaut und nur ausgeblendet, damit laufende Importe beim Schliessen im Hintergrund weitergehen. */
export default function ImportModal({ modules }: { modules: ModuleDescriptor[] }) {
  const { open, mounted, busy } = useImportModal()
  const panel = useRef<HTMLDivElement>(null)
  // Link im Import (z.B. «Modul →») führt weg: Fenster schliessen. Der Rücksprung von /import zählt nicht.
  const { pathname } = useLocation()
  const prevPath = useRef(pathname)
  useEffect(() => {
    if (prevPath.current !== pathname && prevPath.current !== '/import') closeImport()
    prevPath.current = pathname
  }, [pathname])

  useEffect(() => {
    if (!open) return
    // Fokus: beim Schliessen zurück zum Knopf, der geöffnet hat; Tab bleibt im Fenster
    const previous = document.activeElement as HTMLElement | null
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeImport()
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, summary')].filter((x) => x.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panel.current.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', key)
    // Seite dahinter nicht mitscrollen
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', key)
      document.body.style.overflow = overflow
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [open])

  if (!mounted) return null
  return (
    <div className={open ? 'fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 sm:items-start sm:p-6' : 'hidden'} onClick={closeImport} aria-hidden={!open}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col bg-gray-50 shadow-2xl outline-none sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b bg-white px-4 py-2 sm:rounded-t-2xl" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
          <h2 id="import-title" className="text-lg font-bold text-gray-800">
            📥 Daten importieren
          </h2>
          <button type="button" onClick={closeImport} className="min-h-11 rounded-lg px-3 text-sm font-medium text-gray-700 active:bg-gray-100" title={busy ? 'Schliessen: der Import läuft im Hintergrund weiter' : 'Schliessen (Esc)'}>
            {busy ? 'Im Hintergrund weiter ✕' : 'Schliessen ✕'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-8">
          <Upload modules={modules} inModal />
        </div>
      </div>
    </div>
  )
}

/** Alte Adresse /import (Lesezeichen, Links von aussen): Fenster öffnen und zur vorherigen Seite zurück, sonst zur
 * Startseite. */
export function ImportRoute() {
  const navigate = useNavigate()
  useEffect(() => {
    openImport()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/dashboard', { replace: true })
  }, [navigate])
  return null
}
