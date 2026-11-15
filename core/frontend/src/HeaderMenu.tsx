import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/** Aufklappmenü der Kopfzeile (⚙️ Einstellungen, 👤 Profil), überall gleich: Symbol öffnet und schliesst, Klick
 * daneben oder Esc schliesst (Fokus zurück aufs Symbol), Pfeiltasten wählen. Öffnet selbst nichts. */
export default function HeaderMenu({
  label,
  icon,
  children,
  width = 'w-72',
}: {
  label: string
  icon: ReactNode
  /** Inhalt; `close` schliesst das Menü (vor einer Aktion aufrufen) */
  children: (close: () => void) => ReactNode
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) button.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    // Tastatur: erster Eintrag bekommt den Fokus
    if (window.matchMedia?.('(pointer: fine)').matches) box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    if (items.length === 0) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <div ref={box} className="sm:relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        className={`grid min-h-12 min-w-10 place-items-center rounded-full sm:min-w-12 text-xl active:bg-gray-100 ${open ? 'bg-gray-200' : ''}`}
      >
        {icon}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={`absolute right-2 top-full z-[2300] mt-1 max-h-[75vh] ${width} max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl bg-white py-1 shadow-2xl ring-1 ring-black/10 sm:right-0`}>
          {/* Fokus zurück aufs Symbol: ein danach geöffnetes Seitenfenster gibt ihn beim Schliessen dorthin zurück */}
          {children(() => close(true))}
        </div>
      )}
    </div>
  )
}

/** Eintrag im Aufklappmenü (einheitliche Grösse, Tastatur). */
export function MenuItem({ onSelect, children, disabled, danger }: { onSelect: () => void; children: ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm outline-none focus-visible:bg-gray-100 active:bg-gray-100 disabled:opacity-50 ${danger ? 'text-red-800' : 'text-gray-900'}`}
    >
      {children}
    </button>
  )
}
