import { useEffect, useState, type RefObject } from 'react'

export interface JumpColumn {
  key: string
  kind: 'group' | 'list'
  title: string
  count: number
}

/** Spalte, deren linker Rand dem des Spaltenbereichs am nächsten liegt (die gerade gezeigte am Handy). */
export function currentColumn(scroller: HTMLElement): string | null {
  const left = scroller.getBoundingClientRect().left
  let best: { key: string; d: number } | null = null
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-drop-col]')) {
    const d = Math.abs(el.getBoundingClientRect().left - left)
    if (el.dataset.dropCol && (!best || d < best.d - 1)) best = { key: el.dataset.dropCol, d }
  }
  return best?.key ?? null
}

/** Schnellauswahl der Spalten (Tiergruppen und Merklisten) statt waagrecht wischen; zeigt die gerade sichtbare Spalte. */
export default function ColumnJump({ columns, scroller, onJump }: { columns: JumpColumn[]; scroller: RefObject<HTMLDivElement | null>; onJump: (key: string) => void }) {
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setCurrent(currentColumn(el)))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', update)
      mo.disconnect()
    }
  }, [scroller])
  const groups = columns.filter((c) => c.kind === 'group')
  const lists = columns.filter((c) => c.kind === 'list')
  const option = (c: JumpColumn) => (
    <option key={c.key} value={c.key}>
      {c.title} ({c.count})
    </option>
  )
  if (columns.length === 0) return null
  return (
    <select
      aria-label="Gruppe oder Merkliste zeigen"
      value={current && columns.some((c) => c.key === current) ? current : ''}
      onChange={(e) => e.target.value && onJump(e.target.value)}
      className="min-h-9 min-w-0 flex-1 truncate rounded-lg border-2 border-gray-300 bg-white px-2 text-sm font-medium text-gray-900 sm:max-w-xs"
    >
      {!current && <option value="">Gruppe oder Liste…</option>}
      {groups.length > 0 && <optgroup label="Tiergruppen">{groups.map(option)}</optgroup>}
      {lists.length > 0 && <optgroup label="Merklisten">{lists.map(option)}</optgroup>}
    </select>
  )
}
