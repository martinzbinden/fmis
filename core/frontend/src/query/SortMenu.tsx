import { useEffect, useRef, useState } from 'react'
import { QUERY_SORT_KEY } from './useListQuery'

export interface SortChoice {
  key: string
  label: string
}

/** Sortierfeld mit Pfeil-Icon als Aufklappmenü. Zeigt die Sortierung, die die Formel vorschlägt (`autoLabel`), blinkt kurz, wenn
 * sie neu vorgeschlagen wird (`flash`), und hat unten das Kontrollkästchen «Nach Filter automatisch sortieren». */
export default function SortMenu({
  options,
  value,
  onChange,
  autoLabel,
  autoOn,
  onAutoChange,
  flash,
  className = '',
}: {
  options: SortChoice[]
  value: string
  onChange: (key: string) => void
  /** Beschriftung der vorgeschlagenen Sortierung (null = keine Formel mit Zahlenfeld) */
  autoLabel: string | null
  autoOn: boolean
  onAutoChange: (on: boolean) => void
  flash: boolean
  className?: string
}) {
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
  const isAuto = value === QUERY_SORT_KEY
  const current = isAuto ? `Filter: ${autoLabel ?? ''}` : (options.find((o) => o.key === value)?.label ?? '')
  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Sortierung: ${current}`}
        title={isAuto ? 'Sortierung nach dem Filter (automatisch). Antippen, um eine andere zu wählen.' : 'Sortierung'}
        className={`flex min-h-11 items-center gap-2 rounded-lg border-2 bg-white px-3 text-sm ${isAuto ? 'border-amber-500 font-semibold text-amber-900' : 'border-gray-300 text-gray-900'} ${flash ? 'animate-pulse ring-4 ring-amber-300' : ''}`}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 16V4m0 0L3 7m3-3 3 3M14 4v12m0 0 3-3m-3 3-3-3" />
        </svg>
        <span className="max-w-[12rem] truncate">{current}</span>
        <span aria-hidden className="text-gray-500">▾</span>
      </button>
      {open && (
        <div role="group" aria-label="Sortierung" className="absolute right-0 z-30 mt-1 w-72 max-w-[90vw] rounded-xl border border-gray-300 bg-white p-2 shadow-xl">
          <ul>
            {autoLabel && (
              <li>
                <button type="button" role="menuitemradio" aria-checked={isAuto} onClick={() => { onChange(QUERY_SORT_KEY); setOpen(false) }} className={`flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-sm active:bg-gray-100 ${isAuto ? 'bg-amber-50 font-semibold text-amber-900' : ''}`}>
                  <span aria-hidden className="w-4">{isAuto ? '●' : '○'}</span>
                  Nach Filter: {autoLabel}
                </button>
              </li>
            )}
            {options.map((o) => (
              <li key={o.key}>
                <button type="button" role="menuitemradio" aria-checked={value === o.key} onClick={() => { onChange(o.key); setOpen(false) }} className={`flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-sm active:bg-gray-100 ${value === o.key ? 'bg-brand-50 font-semibold' : ''}`}>
                  <span aria-hidden className="w-4">{value === o.key ? '●' : '○'}</span>
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-1 flex min-h-11 cursor-pointer items-start gap-3 border-t px-2 pt-2 text-sm text-gray-800">
            <input type="checkbox" checked={autoOn} onChange={(e) => onAutoChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700" />
            <span>
              Nach Filter automatisch sortieren
              <span className="block text-xs text-gray-600">Passt eine Formel wie «ZZ &gt; 200» zu einem Zahlenfeld, wird danach sortiert. Eine eigene Wahl hier gilt vorrangig.</span>
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
