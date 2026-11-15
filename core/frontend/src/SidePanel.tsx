import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { closePanel, openPanel, panelNavigated, useOpenPanel, type PanelKey } from './headerPanel'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** Unterkante der sichtbaren Kopfzeile (data-app-header), darunter liegt das Fenster: die Symbole bleiben bedienbar. */
function headerBottom(): number {
  const h = document.querySelector<HTMLElement>('[data-app-header]')
  const b = h?.getBoundingClientRect().bottom ?? 0
  return Math.max(0, Math.round(b))
}

/** Seitenfenster der Kopfzeile (Status, Import, Verlauf, Benachrichtigungen, Profil), überall gleich:
 * am PC rechts unter der Kopfzeile (die Seite bleibt daneben sichtbar), am Handy ganze Breite. Titel, ✕, Esc,
 * Klick daneben schliesst; Tab bleibt im Fenster, danach Fokus zurück zum Symbol. `keepMounted`: bleibt
 * geschlossen aufgebaut (Import läuft weiter). */
export default function SidePanel({
  panel,
  title,
  children,
  actions,
  wide = false,
  keepMounted = false,
}: {
  panel: PanelKey
  title: string
  children: ReactNode
  /** Knöpfe im Kopf des Fensters, links vom ✕ */
  actions?: ReactNode
  wide?: boolean
  keepMounted?: boolean
}) {
  const openKey = useOpenPanel()
  const open = openKey === panel
  const [mounted, setMounted] = useState(open)
  const [top, setTop] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => setTop(headerBottom())
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const fine = window.matchMedia?.('(pointer: fine)').matches
    // am PC ins Fenster, am Handy nicht (Tastatur würde aufspringen)
    if (fine) box.current?.focus({ preventScroll: true })
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // ein offenes Menü oder Dialog darüber zuerst
        if (document.querySelector('[role="menu"]')) return
        e.preventDefault()
        closePanel(panel)
        return
      }
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!box.current.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === box.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = overflow
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [open, panel])

  if (!open && !(keepMounted && mounted)) return null
  return (
    <div className={open ? 'fixed inset-x-0 bottom-0 z-[1900] flex justify-end' : 'hidden'} style={{ top }} aria-hidden={!open}>
      {/* Seite daneben abgedunkelt; antippen schliesst */}
      <div className="absolute inset-0 bg-black/30" onClick={() => closePanel(panel)} aria-hidden />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex h-full w-full flex-col bg-gray-50 shadow-2xl outline-none sm:border-l ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b bg-white px-4 py-1.5">
          <h2 id={titleId} className="min-w-0 truncate text-lg font-bold text-gray-800">
            {title}
          </h2>
          <span className="flex shrink-0 items-center gap-1">
            {actions}
            <button type="button" onClick={() => closePanel(panel)} aria-label={`${title} schliessen`} title="Schliessen (Esc)" className="grid h-11 w-11 place-items-center rounded-full text-xl text-gray-600 active:bg-gray-100">
              ✕
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">{children}</div>
      </div>
    </div>
  )
}

/** Einmal in der App: schliesst das offene Fenster bei jedem Seitenwechsel. */
export function PanelRouteWatcher() {
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    panelNavigated()
  }, [pathname])
  return null
}

/** Symbol in der Kopfzeile, das ein Seitenfenster auf- und zuklappt (gleicher Stil für alle). */
export function PanelButton({ panel, label, children, className = '', badge, onOpen }: { panel: PanelKey; label: string; children: ReactNode; className?: string; badge?: ReactNode; onOpen?: () => void }) {
  const open = useOpenPanel() === panel
  return (
    <button
      type="button"
      onClick={() => {
        if (!open) onOpen?.()
        if (open) closePanel(panel)
        else openPanel(panel)
      }}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={`relative min-h-12 min-w-10 place-items-center sm:min-w-12 rounded-full text-xl active:bg-gray-100 ${open ? 'bg-gray-200' : ''} ${className || 'grid'}`}
    >
      {children}
      {badge}
    </button>
  )
}
