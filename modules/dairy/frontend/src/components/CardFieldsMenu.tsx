import { useEffect, useRef, useState } from 'react'
import { CARD_FIELDS, type CardFieldKey } from '../lib/cardFields'

/** Aufklappmenü «Karte» mit Mehrfachauswahl: welche Eigenschaften stehen auf den Dashboard-Karten. */
export default function CardFieldsMenu({ species, selected, onChange }: { species: 'sheep' | 'cattle'; selected: CardFieldKey[]; onChange: (next: CardFieldKey[]) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const fields = CARD_FIELDS.filter((f) => !f.species || f.species === species)
  const chosen = fields.filter((f) => selected.includes(f.key))

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const toggle = (k: CardFieldKey) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k])

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm">
        Karte ({chosen.length}/{fields.length}) ▾
      </button>
      {open && (
        <div role="group" aria-label="Eigenschaften auf der Karte" className="absolute right-0 z-30 mt-1 w-80 max-w-[90vw] rounded-xl border border-gray-300 bg-white p-2 shadow-xl">
          <div className="mb-1 flex gap-2">
            <button type="button" onClick={() => onChange(fields.map((f) => f.key))} className="min-h-11 flex-1 rounded-lg border-2 border-gray-300 px-2 text-sm font-semibold">
              Alle
            </button>
            <button type="button" onClick={() => onChange([])} className="min-h-11 flex-1 rounded-lg border-2 border-gray-300 px-2 text-sm font-semibold">
              Keine
            </button>
          </div>
          <ul>
            {fields.map((f) => (
              <li key={f.key}>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded px-1 py-1.5 active:bg-gray-100">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700" checked={selected.includes(f.key)} onChange={() => toggle(f.key)} />
                  <span className="text-sm text-gray-900">
                    {f.label}
                    <span className="block text-xs text-gray-600">{f.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
