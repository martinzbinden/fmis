import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useEarTagFilter } from '../hooks/useEarTagFilter'
import EarTagFilterInput from '../components/EarTagFilterInput'
import { importOwnLambs, loadOwnMastLambs, type OwnLamb } from '../lib/ownLambs'
import { useDb } from '@fmis/core/DbContext'
import { fmtKg, fmtAge, num } from '../lib/format'
import type { AnimalStatus } from '../types'
import { shortEarTag } from '@fmis/core/earTag'

interface Row {
  id: string
  ear_tag: string
  status: AnimalStatus
  birth_date: string | null
  last_weight: unknown
  group_name: string | null
}

async function loadAnimals(pg: PGlite): Promise<Row[]> {
  const { rows } = await pg.query<Row>(`
    select
      a.id, a.ear_tag, a.status, a.birth_date,
      w_last.weight_kg as last_weight,
      g.name as group_name
    from animals a
    left join lateral (
      select weight_kg from weighings w
      where w.animal_id = a.id and w.deleted_at is null
      order by w.date desc, w.updated_at desc limit 1
    ) w_last on true
    left join lateral (
      select gm.group_id
      from group_memberships gm
      where gm.animal_id = a.id and gm.deleted_at is null and gm.end_date is null
      order by gm.start_date desc limit 1
    ) cur_gm on true
    left join animal_groups g on g.id = cur_gm.group_id and g.deleted_at is null
    where a.deleted_at is null
    order by (a.status = 'aktiv') desc, a.ear_tag
  `)
  return rows
}

const STATUS_LABEL: Record<AnimalStatus, string> = {
  aktiv: 'Aktiv',
  verkauft: 'Verkauft',
  geschlachtet: 'Geschlachtet',
  verendet: 'Verendet',
}

const STATUS_COLOR: Record<AnimalStatus, string> = {
  aktiv: 'bg-green-100 text-green-800',
  verkauft: 'bg-blue-100 text-blue-800',
  geschlachtet: 'bg-gray-200 text-gray-700',
  verendet: 'bg-red-100 text-red-800',
}

const today = () => new Date().toISOString().slice(0, 10)

function ImportLink() {
  return (
    <Link to="/import" className="block rounded-lg border border-gray-200 bg-white p-4 text-sm active:bg-gray-50">
      <span className="font-semibold text-brand-700">📥 Tiere importieren</span>
      <span className="block text-xs text-gray-500">
        TVD-Begleitdokument (PDF) oder CSV <code>ear_tag,birth_date,sex</code> — auf der zentralen Upload-Seite.
      </span>
    </Link>
  )
}

/** Mast-Entscheide aus der Lämmer-Selektion der Milchschafe übernehmen
 * (lib/ownLambs.ts). */
function OwnLambsForm({ onDone }: { onDone: () => void }) {
  const db = useDb()
  const { data: groups } = useQuery((pg) =>
    pg.query<{ id: string; name: string }>("select id, name from animal_groups where deleted_at is null and status = 'aktiv' order by created_date desc").then((r) => r.rows),
  )
  const [lambs, setLambs] = useState<OwnLamb[] | null | undefined>(undefined)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupId, setGroupId] = useState('neu')
  const [groupName, setGroupName] = useState(`Eigene Lämmer ${today()}`)
  const [entryDate, setEntryDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadOwnMastLambs(db).then((l) => {
      setLambs(l)
      setSelected(new Set((l ?? []).map((x) => x.ear_tag)))
    })
  }, [db])

  async function handleImport() {
    if (!lambs) return
    setBusy(true)
    setError(null)
    try {
      await importOwnLambs(
        lambs.filter((l) => selected.has(l.ear_tag)),
        groupId === 'neu' ? { newGroupName: groupName.trim() || `Eigene Lämmer ${entryDate}` } : { groupId },
        entryDate,
      )
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übernahme fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function toggle(tag: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      {lambs === undefined && <p className="text-sm text-gray-500">Lese Selektion der Milchschafe…</p>}
      {lambs === null && (
        <p className="text-sm text-gray-600">
          Die Milchschafe sind auf diesem Gerät noch nicht geladen. Einmal die Milchschafe öffnen, dann hier erneut versuchen.
        </p>
      )}
      {lambs && lambs.length === 0 && (
        <p className="text-sm text-gray-600">
          Keine neuen Mastlämmer. In den Milchschafen unter Erfassen → Lämmer-Selektion «Mast» wählen.
        </p>
      )}
      {lambs && lambs.length > 0 && (
        <>
          <p className="text-sm text-gray-600">In der Lämmer-Selektion als Mast markiert, im Mastplaner noch nicht vorhanden:</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {lambs.map((l) => (
              <li key={l.ear_tag}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.has(l.ear_tag)} onChange={() => toggle(l.ear_tag)} />
                  <span className="font-semibold">{shortEarTag(l.ear_tag)}</span>
                  <span className="text-gray-500">
                    {l.sex === 'w' ? '♀' : '♂'} · {fmtAge(l.birth_date)}
                    {l.dam_ear_tag ? ` · Mutter ${shortEarTag(l.dam_ear_tag)}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <label className="block text-sm">
            Gruppe
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="mt-1 w-full rounded border border-gray-300 p-2">
              <option value="neu">Neue Gruppe</option>
              {(groups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {groupId === 'neu' && (
            <label className="block text-sm">
              Gruppenname
              <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} className="mt-1 w-full rounded border border-gray-300 p-2" />
            </label>
          )}
          <label className="block text-sm">
            Eingangsdatum
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="mt-1 w-full rounded border border-gray-300 p-2" />
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={busy || selected.size === 0}
            className="w-full rounded-lg bg-brand-700 px-5 py-3 font-semibold text-white active:bg-brand-800 disabled:opacity-50"
          >
            {busy ? 'Übernehme…' : `${selected.size} Lämmer übernehmen`}
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

export default function Animals() {
  const { data, loading, refresh } = useQuery(loadAnimals)
  const [showImport, setShowImport] = useState(false)
  const [showOwn, setShowOwn] = useState(false)
  const { filter, setFilter, filtered } = useEarTagFilter(data, (a) => a.ear_tag)

  if (loading && !data) {
    return <div className="p-4 text-center text-gray-400">Lädt…</div>
  }

  const animals = data ?? []
  const visibleAnimals = filtered ?? []

  if (animals.length === 0) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="mb-4 text-center text-gray-500">Noch keine Tiere erfasst.</p>
        <ImportLink />
        <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Eigene Lämmer aus der Milchschaf-Selektion</h2>
        <OwnLambsForm onDone={refresh} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Tiere ({animals.length})</h1>
        <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowOwn((v) => !v)}
          className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
        >
          {showOwn ? 'Schliessen' : 'Eigene Lämmer'}
        </button>
        <button
          type="button"
          onClick={() => setShowImport((v) => !v)}
          className="rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
        >
          {showImport ? 'Schliessen' : '+ Tiere importieren'}
        </button>
        </div>
      </div>
      {showOwn && (
        <div className="mb-4">
          <OwnLambsForm
            onDone={() => {
              setShowOwn(false)
              refresh()
            }}
          />
        </div>
      )}
      {showImport && (
        <div className="mb-4">
          <ImportLink />
        </div>
      )}
      <div className="mb-3">
        <EarTagFilterInput value={filter} onChange={setFilter} />
      </div>
      {visibleAnimals.length === 0 && (
        <p className="text-center text-gray-500">Keine Tiere gefunden.</p>
      )}
      <ul className="space-y-2">
        {visibleAnimals.map((a) => (
          <li key={a.id}>
            <Link
              to={`/livestock/tiere/${a.id}`}
              className="flex items-center justify-between rounded-lg bg-white p-3 shadow-sm active:bg-gray-50"
            >
              <div>
                <div className="font-semibold text-gray-800">{shortEarTag(a.ear_tag)}</div>
                <div className="text-xs text-gray-500">
                  {fmtAge(a.birth_date)}
                  {a.group_name ? ` · ${a.group_name}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-gray-700">{fmtKg(num(a.last_weight))}</span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLOR[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
