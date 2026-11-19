import { useEffect, useRef, useState } from 'react'
import { TOTAL_PERIODS, type ColumnTotalsSettings } from '../lib/columnTotals'

/** Aufklappmenü «Σ Summen»: welche Kennzahlen unten in jeder Spalte stehen und für welchen Zeitraum. */
export default function ColumnTotalsMenu({ value, onChange, sheep }: { value: ColumnTotalsSettings; onChange: (v: ColumnTotalsSettings) => void; sheep: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
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
  const n = (sheep && value.meat ? 1 : 0) + (value.milk ? 1 : 0) + (value.feed ? 1 : 0)
  const item = (k: 'meat' | 'milk' | 'feed', label: string, hint: string) => (
    <label key={k} className="flex min-h-11 cursor-pointer items-start gap-3 rounded px-1 py-1.5 active:bg-gray-100">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700" checked={value[k]} onChange={() => onChange({ ...value, [k]: !value[k] })} />
      <span className="text-sm text-gray-900">
        {label}
        <span className="block text-xs text-gray-600">{hint}</span>
      </span>
    </label>
  )
  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" className="min-h-11 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm">
        Σ Summen ({n}) ▾
      </button>
      {open && (
        <div role="group" aria-label="Summen je Spalte" className="absolute right-0 z-30 mt-1 w-80 max-w-[90vw] rounded-xl border border-gray-300 bg-white p-2 shadow-xl">
          <p className="px-1 pb-1 text-xs text-gray-600">Unten in jeder Gruppe und Merkliste, für alle ihre Tiere.</p>
          {sheep && item('meat', '🥩 Schlachtwert', 'Fleischwert nach Abzügen am Schlachttermin (Einstellungen: ⚙️ Einstellungen)')}
          {item('milk', '🥛 Milch', 'Gemolkene Milch und ihr Wert im Zeitraum, aus der letzten Wägung (Einstellungen: Milch gegen Futter)')}
          {item('feed', '🌾 Futterbedarf', 'Grundfutter in kg und Futterkosten (inkl. Kraftfutter je kg Milch) im Zeitraum')}
          <fieldset className="mt-1 border-t px-1 pt-2">
            <legend className="sr-only">Zeitraum</legend>
            <span className="text-xs font-semibold text-gray-700">Zeitraum</span>
            <div className="mt-1 flex gap-2">
              {TOTAL_PERIODS.map((p) => (
                <label key={p.days} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border-2 text-sm ${value.days === p.days ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-300'}`}>
                  <input type="radio" name="totals-period" className="sr-only" checked={value.days === p.days} onChange={() => onChange({ ...value, days: p.days })} />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  )
}
