import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const FOOTER_SLOT_ID = 'fmis-footer-slot'

/** Laufender Zwischenstand direkt über dem Menü (z.B. Ergebnisse eines
 * Trächtigkeits-Durchgangs). Bleibt beim Scrollen sichtbar; die Seite braucht
 * unten etwas mehr Abstand (z.B. pb-36), damit nichts verdeckt wird. */
export default function FooterBar({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(FOOTER_SLOT_ID)), [])
  if (!slot) return null
  return createPortal(
    <div className="border-t-2 border-brand-700 bg-white px-3 py-1.5 shadow-[0_-2px_6px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">{children}</div>
    </div>,
    slot,
  )
}
