import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

// Gemeinsamer Dialog aller Module (vorher je Modul eine Kopie).
//
// Schutz vor Datenverlust (Traktor, Erschütterung, Hosentasche):
//  - Ein Tipp NEBEN den Dialog schliesst nur einen Dialog, in dem noch nichts
//    angefasst wurde. Sobald jemand darin tippt oder klickt, wird er ignoriert.
//  - Kreuz und Escape fragen nach, wenn etwas EINGEGEBEN wurde.
// Tastatur (Desktop): Escape schliesst, Ctrl/Cmd+Enter speichert (wenn das
// Formular `onSubmit` angibt), Tab bleibt im Dialog, Fokus kehrt danach zum
// auslösenden Element zurück.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({
  title,
  onClose,
  onSubmit,
  dirty,
  children,
}: {
  title: string
  onClose: () => void
  /** Ctrl/Cmd+Enter — normalerweise «Speichern» */
  onSubmit?: () => void
  /** überschreibt die automatische Erkennung «es wurde etwas eingegeben» */
  dirty?: boolean
  children: ReactNode
}) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)
  const [edited, setEdited] = useState(false)
  const [engaged, setEngaged] = useState(false)
  const needsConfirm = dirty ?? edited

  // Fokus: auf dem Desktop ins erste Feld, am Handy nicht (die Tastatur
  // würde sofort aufspringen und den Dialog verdecken).
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = box.current
    if (el && !el.contains(document.activeElement)) {
      const fine = window.matchMedia?.('(pointer: fine)').matches
      const first = fine ? el.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') : null
      ;(first ?? el).focus({ preventScroll: true })
    }
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  function requestClose() {
    if (needsConfirm && !window.confirm('Eingaben verwerfen?')) return
    onClose()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Verschachtelte Dialoge: nur der oberste reagiert
    if (e.key === 'Escape') {
      e.stopPropagation()
      requestClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) {
      e.stopPropagation()
      e.preventDefault()
      onSubmit()
    } else if (e.key === 'Tab' && box.current) {
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
      e.stopPropagation()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === box.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div
      // z-[2000]: höher als Leaflets eigene Stacking-Kontexte (Controls/
      // Toolbar bis z-index 1000) — sonst verschwindet der Dialog hinter
      // der Karte, wenn beide auf derselben Seite liegen.
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={() => {
        if (!engaged && !needsConfirm) onClose()
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onInput={() => setEdited(true)}
        onClickCapture={() => setEngaged(true)}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-lg outline-none sm:rounded-xl sm:pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-bold text-gray-800">
            {title}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            className="-mr-2 grid h-12 w-12 shrink-0 place-items-center rounded-full text-2xl leading-none text-gray-600 active:bg-gray-100"
            aria-label="Schliessen"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
