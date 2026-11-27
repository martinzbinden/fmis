// Kleiner Knopf für Angaben, die sonst nur im «title» (Mauszeiger) stünden: am Handy gibt es kein Überfahren.
// Antippen klappt den Text als kleine Zweitzeile auf (in einer flex-wrap-Zeile über die ganze Breite).

import { useState, type ReactNode } from 'react'

export default function TapInfo({ info, children, className = '', title }: { info: ReactNode; children: ReactNode; className?: string; title?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={title} className={className}>
        {children}
      </button>
      {open && <span className="block basis-full text-xs font-normal text-gray-600">{info}</span>}
    </>
  )
}
