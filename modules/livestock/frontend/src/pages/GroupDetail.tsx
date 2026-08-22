import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { fmtDate, fmtChf, num, todayIso } from '../lib/format'
import type { AnimalGroup, FeedRecord, Expense } from '../types'

interface Member {
  membership_id: string
  animal_id: string
  ear_tag: string
  start_date: string
  end_date: string | null
}

interface Detail {
  group: AnimalGroup
  members: Member[]
  feed: FeedRecord[]
  expenses: Expense[]
}

function loadDetail(id: string) {
  return async (pg: PGlite): Promise<Detail | null> => {
    const { rows: groupRows } = await pg.query<AnimalGroup>(
      'select * from animal_groups where id = $1 and deleted_at is null',
      [id],
    )
    if (groupRows.length === 0) return null

    const { rows: members } = await pg.query<Member>(
      `select gm.id as membership_id, gm.animal_id, a.ear_tag, gm.start_date, gm.end_date
       from group_memberships gm
       join animals a on a.id = gm.animal_id
       where gm.group_id = $1 and gm.deleted_at is null
       order by gm.end_date nulls first, a.ear_tag`,
      [id],
    )
    const { rows: feed } = await pg.query<FeedRecord>(
      'select * from feed_records where group_id = $1 and deleted_at is null order by date desc',
      [id],
    )
    const { rows: expenses } = await pg.query<Expense>(
      'select * from expenses where group_id = $1 and deleted_at is null order by date desc',
      [id],
    )

    return { group: groupRows[0], members, feed, expenses }
  }
}

export default function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, refresh } = useQuery(loadDetail(id!), [id])

  const [minKg, setMinKg] = useState('')
  const [maxKg, setMaxKg] = useState('')
  const [editingTarget, setEditingTarget] = useState(false)

  const [expCategory, setExpCategory] = useState('')
  const [expDescription, setExpDescription] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expDate, setExpDate] = useState(todayIso())
  const [savingExpense, setSavingExpense] = useState(false)

  if (loading && !data) return <div className="p-4 text-center text-gray-400">Lädt…</div>
  if (!data) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Gruppe nicht gefunden.</p>
        <Link to="/gruppen" className="mt-2 inline-block text-brand-700 underline">
          Zurück zur Liste
        </Link>
      </div>
    )
  }

  const { group, members, feed, expenses } = data

  async function saveTarget() {
    const min = Number(minKg || group.target_weight_min_kg)
    const max = Number(maxKg || group.target_weight_max_kg)
    await upsertRow('animal_groups', { ...group, target_weight_min_kg: min, target_weight_max_kg: max })
    setEditingTarget(false)
    refresh()
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    if (!expCategory || !expAmount) return
    setSavingExpense(true)
    try {
      await upsertRow('expenses', {
        id: crypto.randomUUID(),
        group_id: group.id,
        date: expDate,
        category: expCategory,
        description: expDescription || null,
        amount: Number(expAmount),
      })
      setExpCategory('')
      setExpDescription('')
      setExpAmount('')
    } finally {
      setSavingExpense(false)
    }
  }

  const totalFeedCost = feed.reduce((sum, f) => sum + (num(f.cost_total) ?? 0), 0)
  const totalExpenses = expenses.reduce((sum, e) => sum + (num(e.amount) ?? 0), 0)

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <Link to="/gruppen" className="text-sm text-brand-700">
          ← Alle Gruppen
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-800">{group.name}</h1>
        <p className="text-sm text-gray-500">Angelegt am {fmtDate(group.created_date)} · {group.status}</p>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Zielgewicht</h2>
          {!editingTarget && (
            <button className="text-sm text-brand-700" onClick={() => setEditingTarget(true)}>
              Bearbeiten
            </button>
          )}
        </div>
        {editingTarget ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              defaultValue={group.target_weight_min_kg}
              onChange={(e) => setMinKg(e.target.value)}
              className="w-24 rounded border border-gray-300 px-2 py-2 text-base"
            />
            <span className="text-gray-500">–</span>
            <input
              type="number"
              step="0.1"
              defaultValue={group.target_weight_max_kg}
              onChange={(e) => setMaxKg(e.target.value)}
              className="w-24 rounded border border-gray-300 px-2 py-2 text-base"
            />
            <span className="text-gray-500">kg</span>
            <button
              onClick={saveTarget}
              className="ml-auto rounded bg-brand-700 px-3 py-2 text-sm font-medium text-white"
            >
              Speichern
            </button>
          </div>
        ) : (
          <p className="text-lg text-gray-800">
            {group.target_weight_min_kg} – {group.target_weight_max_kg} kg
          </p>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Mitglieder ({members.length})</h2>
        {members.length === 0 ? (
          <p className="text-sm text-gray-400">Keine Mitglieder.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.membership_id} className="flex items-center justify-between py-2 text-sm">
                <Link to={`/tiere/${m.animal_id}`} className="font-medium text-brand-700">
                  {m.ear_tag}
                </Link>
                <span className="text-gray-500">
                  {fmtDate(m.start_date)} – {m.end_date ? fmtDate(m.end_date) : 'aktiv'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          Futtereinträge {totalFeedCost > 0 && `· Total ${fmtChf(totalFeedCost)}`}
        </h2>
        {feed.length === 0 ? (
          <p className="text-sm text-gray-400">
            Keine Einträge. <Link to="/futter" className="text-brand-700">Futter erfassen</Link>
          </p>
        ) : (
          <ul className="divide-y">
            {feed.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-gray-800">{f.feed_type}</div>
                  <div className="text-gray-500">
                    {fmtDate(f.date)} · {num(f.quantity)} {f.unit}
                  </div>
                </div>
                <div className="text-gray-700">{f.cost_total != null ? fmtChf(f.cost_total) : '–'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          Sonstige Kosten {totalExpenses > 0 && `· Total ${fmtChf(totalExpenses)}`}
        </h2>
        {expenses.length > 0 && (
          <ul className="mb-3 divide-y">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-gray-800">{e.category}</div>
                  <div className="text-gray-500">
                    {fmtDate(e.date)} {e.description ? `· ${e.description}` : ''}
                  </div>
                </div>
                <div className="text-gray-700">{fmtChf(e.amount)}</div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addExpense} className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={expDate}
            onChange={(e) => setExpDate(e.target.value)}
            className="col-span-2 rounded border border-gray-300 px-3 py-2 sm:col-span-1"
          />
          <input
            type="text"
            placeholder="Kategorie"
            value={expCategory}
            onChange={(e) => setExpCategory(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 sm:col-span-1"
          />
          <input
            type="text"
            placeholder="Beschreibung (optional)"
            value={expDescription}
            onChange={(e) => setExpDescription(e.target.value)}
            className="col-span-2 rounded border border-gray-300 px-3 py-2"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Betrag CHF"
            value={expAmount}
            onChange={(e) => setExpAmount(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={savingExpense}
            className="rounded bg-brand-700 px-3 py-2 font-medium text-white disabled:opacity-50"
          >
            Hinzufügen
          </button>
        </form>
      </section>
    </div>
  )
}
