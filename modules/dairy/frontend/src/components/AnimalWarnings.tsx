import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDb } from '@fmis/core/DbContext'
import { notifyError } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import type { AnimalWarning } from '../lib/animalWarnings'
import { addToWatchlist, createWatchlist, loadWatchlists } from '../lib/watchlists'

// Ignorierte Warnungen gelten bis zum Neuladen der App (je Tier und Regel).
const ignored = new Set<string>()

/** Warnungen zu einem Tier: ignorieren, auf eine Merkliste setzen (bestehende oder neue)
 * oder – in Listen-Erfassungen – aus der neuen Liste entfernen. */
export default function AnimalWarnings({
  animalIds,
  warnings,
  onRemove,
  removeLabel = 'Aus der Liste entfernen',
  compact = false,
}: {
  /** betroffene Tiere (bei Sammel-Warnungen mehrere) */
  animalIds: string[]
  warnings: AnimalWarning[]
  onRemove?: () => void
  removeLabel?: string
  compact?: boolean
}) {
  const [, bump] = useState(0)
  const visible = warnings.filter((w) => !ignored.has(w.id))
  if (visible.length === 0) return null
  return (
    <ul className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {visible.map((w) => (
        <WarningRow
          key={w.id}
          w={w}
          animalIds={animalIds}
          compact={compact}
          onIgnore={() => {
            ignored.add(w.id)
            bump((n) => n + 1)
          }}
          onRemove={w.suggestRemove ? onRemove : undefined}
          removeLabel={removeLabel}
        />
      ))}
    </ul>
  )
}

function WarningRow({
  w,
  animalIds,
  compact,
  onIgnore,
  onRemove,
  removeLabel,
}: {
  w: AnimalWarning
  animalIds: string[]
  compact: boolean
  onIgnore: () => void
  onRemove?: () => void
  removeLabel: string
}) {
  const [picking, setPicking] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const membership = w.id.includes(':list:')
  const cls = w.tone === 'warn' ? 'border-amber-500 bg-amber-50 text-amber-950' : 'border-sky-300 bg-sky-50 text-sky-950'
  return (
    <li className={`rounded-lg border-l-4 px-2.5 py-1.5 text-sm ${cls}`}>
      <div className="flex items-start gap-1.5">
        <span aria-hidden>{membership ? '📋' : w.tone === 'warn' ? '⚠' : 'ℹ'}</span>
        <span className="min-w-0 flex-1">{w.text}</span>
      </div>
      {!membership && (
        <div className={`mt-1 flex flex-wrap gap-1.5 ${compact ? '' : 'pl-5'}`}>
          {onRemove && (
            <button type="button" onClick={onRemove} className="min-h-9 rounded-lg bg-amber-600 px-2.5 text-sm font-semibold text-white">
              {removeLabel}
            </button>
          )}
          <button type="button" onClick={() => setPicking((p) => !p)} className="min-h-9 rounded-lg border border-gray-400 bg-white px-2.5 text-sm font-medium text-gray-800">
            + Merkliste
          </button>
          <button type="button" onClick={onIgnore} className="min-h-9 rounded-lg px-2 text-sm text-gray-700 underline">
            Ignorieren
          </button>
        </div>
      )}
      {done && <p className="mt-1 text-sm font-semibold text-green-800">✓ {done}</p>}
      {picking && (
        <WatchlistPicker
          animalIds={animalIds}
          reason={w.text}
          suggest={w.suggestList}
          onDone={(msg) => {
            setPicking(false)
            setDone(msg)
          }}
        />
      )}
    </li>
  )
}

/** Merkliste wählen oder neu anlegen und die Tiere daraufsetzen. */
export function WatchlistPicker({ animalIds, reason, suggest, onDone }: { animalIds: string[]; reason: string | null; suggest?: string; onDone: (msg: string) => void }) {
  const db = useDb()
  const base = `/${useLocation().pathname.split('/')[1]}`
  const { data } = useQuery(loadWatchlists)
  const lists = (data?.lists ?? []).filter((l) => !l.archived_at)
  const [name, setName] = useState(() => (suggest && !lists.some((l) => l.name === suggest) ? suggest : ''))
  const [busy, setBusy] = useState(false)
  const sorted = [...lists].sort((a, b) => Number(b.name === suggest) - Number(a.name === suggest))
  const suggestMissing = suggest && data && !lists.some((l) => l.name.toLowerCase() === suggest.toLowerCase())

  async function add(listId: string | null, listName: string) {
    if (busy) return
    setBusy(true)
    try {
      const id = listId ?? (await createWatchlist(db, listName))
      const n = await addToWatchlist(db, id, animalIds, reason)
      onDone(n > 0 ? `Auf «${listName}» gesetzt` : `Stand schon auf «${listName}»`)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded-lg bg-white p-2 text-gray-900">
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((l) => (
            <button
              key={l.id}
              type="button"
              disabled={busy}
              onClick={() => void add(l.id, l.name)}
              className={`min-h-9 rounded-full border-2 px-3 text-sm ${l.name === suggest ? 'border-brand-700 font-semibold text-brand-800' : 'border-gray-300'}`}
            >
              {l.name}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void add(null, name.trim())
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestMissing ? suggest : 'Neue Merkliste'}
          aria-label="Name der neuen Merkliste"
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-gray-300 px-2 text-sm"
        />
        <button type="submit" disabled={busy || !name.trim()} className="min-h-9 shrink-0 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white disabled:opacity-40">
          Neu
        </button>
      </form>
      <Link to={`${base}/merklisten`} className="block text-xs text-brand-700">
        Merklisten verwalten ›
      </Link>
    </div>
  )
}
