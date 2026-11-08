import { useState } from 'react'
import { Link } from 'react-router-dom'
import { animalProvider } from '@fmis/core/animals'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useDb } from '@fmis/core/DbContext'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { addToWatchlist, createWatchlist, loadWatchlists } from '../lib/watchlists'
import JournalForm from './JournalForm'
import ToHerdGroup from './ToHerdGroup'

/** Aktionen für ausgewählte Tiere einer Liste (Tiere, Gruppen). Die Liste zeigt bei
 * gewählter Aktion nur Tiere, für die sie in Frage kommt (`eligible`). */
export type ListAction = 'journal' | 'merkliste' | 'gruppe' | 'absetzen'

export const LIST_ACTIONS: { key: ListAction; icon: string; label: string }[] = [
  { key: 'journal', icon: '💉', label: 'Beobachtung / Behandlung' },
  { key: 'merkliste', icon: '🔖', label: 'Merkliste' },
  { key: 'gruppe', icon: '🐑', label: 'Tiergruppe' },
  { key: 'absetzen', icon: '✂️', label: 'Absetzen' },
]

/** Kommt das Tier für die Aktion in Frage? Absetzen: Mütter mit saugenden Lämmern. */
export function eligibleFor(action: ListAction | '', a: { id: string; status: string }, nursing: Map<string, number>): boolean {
  if (!action) return true
  if (a.status !== 'aktiv') return false
  return action === 'absetzen' ? (nursing.get(a.id) ?? 0) > 0 : true
}

export function ActionChips({ value, onChange, moduleKey }: { value: ListAction | ''; onChange: (a: ListAction | '') => void; moduleKey: string }) {
  const canHerd = useHasPermission('tiere:herden:write') && !!animalProvider(moduleKey)
  return (
    <div className="flex flex-wrap gap-1.5">
      {LIST_ACTIONS.filter((a) => a.key !== 'gruppe' || canHerd).map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={() => onChange(value === a.key ? '' : a.key)}
          className={`min-h-11 rounded-full border px-3 text-sm ${value === a.key ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-300 bg-white text-gray-800'}`}
        >
          {a.icon} {a.label}
        </button>
      ))}
    </div>
  )
}

export function ActionPanel({ moduleKey, action, ids, onDone }: { moduleKey: string; action: ListAction; ids: string[]; onDone: () => void }) {
  if (ids.length === 0) return <p className="text-sm text-gray-700">Tiere oben antippen, dann hier {LIST_ACTIONS.find((a) => a.key === action)?.label}.</p>
  if (action === 'journal')
    return (
      <JournalForm
        animalIds={ids}
        onSaved={() => {
          notifySuccess('Gespeichert')
          onDone()
        }}
      />
    )
  if (action === 'gruppe') return <ToHerdGroup moduleKey={moduleKey} listName="" animalIds={ids} onDone={onDone} />
  if (action === 'absetzen')
    return (
      <Link to={`/${moduleKey}/laemmer?aktion=absetzen&mutter=${ids.join(',')}`} className="flex min-h-12 items-center justify-center rounded-lg bg-brand-700 px-3 font-semibold text-white">
        ✂️ Lämmer von {ids.length} {ids.length === 1 ? 'Mutter' : 'Müttern'} absetzen →
      </Link>
    )
  return <ToWatchlist ids={ids} onDone={onDone} />
}

function ToWatchlist({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const db = useDb()
  const { data } = useQuery(loadWatchlists)
  const [target, setTarget] = useState('new')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const lists = (data?.lists ?? []).filter((l) => !l.archived_at)

  async function save() {
    setBusy(true)
    try {
      const listId = target === 'new' ? await createWatchlist(db, name) : target
      const added = await addToWatchlist(db, listId, ids, reason.trim() || null)
      notifySuccess(`${added} auf die Merkliste`)
      onDone()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const field = 'min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base'
  return (
    <div className="space-y-2 text-sm">
      <select value={target} onChange={(e) => setTarget(e.target.value)} className={field} aria-label="Merkliste">
        <option value="new">+ neue Merkliste</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {target === 'new' && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Merkliste" className={field} />}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund (optional)" className={field} />
      <button type="button" disabled={busy || (target === 'new' && !name.trim())} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50">
        {busy ? 'speichert …' : `${ids.length} Tiere vormerken`}
      </button>
    </div>
  )
}
