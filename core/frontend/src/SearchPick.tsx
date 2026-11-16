import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface PickItem {
  id: string
  label: string
}

/** Auswahlfeld mit Suche (statt <select>): Tippen filtert, Pfeile/Enter wählen, Esc schliesst. Mit `onCreate` steht
 * zuoberst «＋ Neu …» bzw. «＋ «Suchtext» anlegen». */
export default function SearchPick({
  items,
  value,
  onChange,
  placeholder,
  label,
  onCreate,
  createLabel = 'Neu anlegen',
  className = '',
  startOpen = false,
}: {
  items: PickItem[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  /** Name für Screenreader */
  label: string
  /** neuen Eintrag mit diesem Namen anlegen */
  onCreate?: (name: string) => void
  createLabel?: string
  className?: string
  /** gleich offen (z.B. nach Tipp auf ⇄) */
  startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const current = items.find((i) => i.id === value)
  const term = q.trim().toLowerCase()
  const hits = useMemo(() => (term ? items.filter((i) => i.label.toLowerCase().includes(term)) : items), [items, term])
  const exact = items.some((i) => i.label.trim().toLowerCase() === term)
  const canCreate = !!onCreate && term.length > 0 && !exact
  const options: { key: string; label: string; pick: () => void; create?: boolean }[] = [
    ...(canCreate ? [{ key: '__neu', label: `＋ «${q.trim()}» ${createLabel.toLowerCase()}`, pick: () => onCreate!(q.trim()), create: true }] : []),
    ...hits.map((i) => ({ key: i.id, label: i.label, pick: () => onChange(i.id) })),
  ]

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  useEffect(() => setActive(0), [term])

  function choose(i: number) {
    const o = options[i]
    if (!o) return
    o.pick()
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? 'nichts gewählt'}`}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 text-left text-sm"
      >
        <span className={`truncate ${current ? 'text-gray-900' : 'text-gray-500'}`}>{current?.label ?? placeholder}</span>
        <span aria-hidden className="text-gray-500">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[2100] mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-300 bg-white p-1.5 shadow-xl">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(options.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(active)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            role="combobox"
            aria-controls={listId}
            aria-expanded
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            placeholder={onCreate ? 'Suchen oder neuen Namen eingeben' : 'Suchen'}
            aria-label={`${label} suchen`}
            className="mb-1 min-h-10 w-full rounded border border-gray-300 px-2 text-base sm:text-sm"
          />
          <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
            {options.map((o, i) => (
              <li
                key={o.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.key === value}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onPointerEnter={() => setActive(i)}
                className={`flex min-h-10 cursor-pointer items-center rounded px-2 text-sm ${i === active ? 'bg-brand-100 text-brand-900' : 'text-gray-800'} ${o.create ? 'font-semibold text-brand-800' : ''} ${o.key === value ? 'font-semibold' : ''}`}
              >
                {o.label}
              </li>
            ))}
            {options.length === 0 && <li className="px-2 py-2 text-sm text-gray-500">{onCreate ? 'Namen eingeben, um neu anzulegen' : 'Nichts gefunden'}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
