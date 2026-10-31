import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { animalLabel } from '@fmis/core/earTag'
import { notifyError } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import AnimalPicker from '../components/AnimalPicker'
import { fmtDate } from '../lib/format'
import { addToWatchlist, createWatchlist, loadWatchlists, removeEntry, saveWatchlist, setEntryDone, type Watchlist, type WatchlistEntry } from '../lib/watchlists'
import type { Animal } from '../types'

async function loadData(pg: PGlite) {
  const [lists, animals] = await Promise.all([
    loadWatchlists(pg),
    pg.query<Animal>('select * from animals where deleted_at is null order by lauf_nr nulls last, ear_tag'),
  ])
  return { ...lists, animals: animals.rows }
}

const tierLabel = (a: Animal | undefined) => (a ? `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${animalLabel(a)}` : 'unbekanntes Tier')

/** Merklisten: frei benannte Listen von Tieren (z.B. «Ausmerzen prüfen»). Tiere kommen von
 * Hand, per Lesegerät oder aus einer Warnung bei der Erfassung dazu. */
export default function Watchlists({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const { data } = useQuery(loadData)
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const byId = useMemo(() => new Map((data?.animals ?? []).map((a) => [a.id, a])), [data])
  const lists = data?.lists ?? []
  const active = lists.filter((l) => !l.archived_at)
  const archived = lists.filter((l) => l.archived_at)
  const entriesOf = (id: string) => (data?.entries ?? []).filter((e) => e.list_id === id)

  async function create() {
    if (!name.trim()) return
    try {
      const id = await createWatchlist(db, name)
      setName('')
      setOpenId(id)
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-3 p-4 pb-24">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Merklisten</h1>
        <span className="flex gap-3">
          <Link to="../gruppen" relative="path" className="text-sm text-brand-700">
            ⚖️ vergleichen
          </Link>
          <Link to="../tierinfo" relative="path" className="text-sm text-brand-700">
            🔎 Tier-Info
          </Link>
        </span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neue Merkliste, z.B. Klauen schneiden" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base" />
        <button type="submit" disabled={!name.trim()} className="min-h-11 shrink-0 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-40">
          Anlegen
        </button>
      </form>

      {data && active.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Noch keine Merkliste. Tiere kommen auch aus Warnungen bei der Erfassung dazu («+ Merkliste»).</p>}

      {active.map((l) => (
        <ListCard
          key={l.id}
          list={l}
          entries={entriesOf(l.id)}
          byId={byId}
          animals={data?.animals ?? []}
          moduleKey={moduleKey}
          open={openId === l.id}
          onToggle={() => setOpenId(openId === l.id ? null : l.id)}
        />
      ))}

      {archived.length > 0 && (
        <section className="space-y-2">
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-sm text-gray-700 underline">
            {showArchived ? 'Archivierte ausblenden' : `${archived.length} archivierte anzeigen`}
          </button>
          {showArchived &&
            archived.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-sm">
                <span className="text-gray-700">
                  {l.name} · {entriesOf(l.id).length} Tiere
                </span>
                <button type="button" onClick={() => void saveWatchlist(db, { ...l, archived_at: null })} className="min-h-10 px-2 text-brand-700">
                  wiederherstellen
                </button>
              </div>
            ))}
        </section>
      )}
    </div>
  )
}

function ListCard({
  list,
  entries,
  byId,
  animals,
  moduleKey,
  open,
  onToggle,
}: {
  list: Watchlist
  entries: WatchlistEntry[]
  byId: Map<string, Animal>
  animals: Animal[]
  moduleKey: string
  open: boolean
  onToggle: () => void
}) {
  const db = useDb()
  const [adding, setAdding] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const openEntries = entries.filter((e) => !e.done_at)
  const done = entries.filter((e) => e.done_at)
  const onList = new Set(openEntries.map((e) => e.animal_id))

  async function add() {
    if (adding.length === 0) return
    await addToWatchlist(db, list.id, adding, reason.trim() || null)
    setAdding([])
    setReason('')
  }

  return (
    <section className="rounded-lg bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left" aria-expanded={open}>
        <span className="font-semibold text-gray-900">{list.name}</span>
        <span className="text-sm text-gray-600">
          {openEntries.length} {openEntries.length === 1 ? 'Tier' : 'Tiere'}
          {done.length > 0 ? ` · ${done.length} erledigt` : ''} {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 pb-3 pt-2">
          <ul className="divide-y">
            {[...openEntries, ...(showDone ? done : [])].map((e) => (
              <li key={e.id} className={`flex items-start gap-2 py-1.5 ${e.done_at ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <Link to={`/${moduleKey}/kuehe/${e.animal_id}`} className={`font-medium text-brand-700 ${e.done_at ? 'line-through' : ''}`}>
                    {tierLabel(byId.get(e.animal_id))}
                  </Link>
                  {e.reason && <div className="text-xs text-gray-700">{e.reason}</div>}
                  <div className="text-xs text-gray-500">
                    {fmtDate(e.added_at)}
                    {e.added_by ? ` · ${e.added_by.split('@')[0]}` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => void setEntryDone(db, e, !e.done_at)} className="min-h-10 shrink-0 rounded-lg border border-gray-300 px-2 text-sm" aria-label={e.done_at ? 'wieder öffnen' : 'erledigt'}>
                  {e.done_at ? '↺' : '✓'}
                </button>
                <button type="button" onClick={() => void removeEntry(db, e.id)} className="min-h-10 shrink-0 rounded-lg px-2 text-sm text-red-700" aria-label="von der Liste entfernen">
                  ✕
                </button>
              </li>
            ))}
            {openEntries.length === 0 && <li className="py-2 text-sm text-gray-600">Keine offenen Tiere.</li>}
          </ul>
          {done.length > 0 && (
            <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-gray-700 underline">
              {showDone ? 'Erledigte ausblenden' : `${done.length} erledigte anzeigen`}
            </button>
          )}

          <div className="space-y-2 rounded-lg bg-gray-50 p-2">
            <div className="text-sm font-medium text-gray-800">Tiere hinzufügen</div>
            <AnimalPicker animals={animals.filter((a) => !onList.has(a.id))} selected={adding} onChange={setAdding} multiple readerModule={moduleKey} />
            {adding.length > 0 && (
              <div className="flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund (optional)" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base" />
                <button type="button" onClick={() => void add()} className="min-h-11 shrink-0 rounded-lg bg-brand-700 px-3 font-semibold text-white">
                  {adding.length} hinzufügen
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            {renaming != null ? (
              <form
                className="flex w-full gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (renaming.trim()) void saveWatchlist(db, { ...list, name: renaming.trim() }).then(() => setRenaming(null))
                }}
              >
                <input value={renaming} onChange={(e) => setRenaming(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-2" aria-label="Neuer Name" />
                <button type="submit" className="min-h-10 rounded-lg bg-brand-700 px-3 font-semibold text-white">
                  OK
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setRenaming(list.name)} className="min-h-10 rounded-lg border border-gray-300 px-3">
                Umbenennen
              </button>
            )}
            <button type="button" onClick={() => void saveWatchlist(db, { ...list, archived_at: new Date().toISOString() })} className="min-h-10 rounded-lg border border-gray-300 px-3">
              Archivieren
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
