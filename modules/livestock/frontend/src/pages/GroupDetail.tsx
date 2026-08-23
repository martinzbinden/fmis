import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { fmtDate, fmtChf, num, todayIso } from '../lib/format'
import type { AnimalGroup, FeedRecord, Expense, GroupStatus } from '../types'

const GROUP_STATUS_OPTIONS: GroupStatus[] = ['aktiv', 'abgeschlossen']

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
  const navigate = useNavigate()
  const { data, loading, refresh } = useQuery(loadDetail(id!), [id])

  const [minKg, setMinKg] = useState('')
  const [maxKg, setMaxKg] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<GroupStatus>('aktiv')
  const [editingGroup, setEditingGroup] = useState(false)

  const [expCategory, setExpCategory] = useState('')
  const [expDescription, setExpDescription] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expDate, setExpDate] = useState(todayIso())
  const [savingExpense, setSavingExpense] = useState(false)

  const [editingFeedId, setEditingFeedId] = useState<string | null>(null)
  const [feedForm, setFeedForm] = useState<Partial<FeedRecord>>({})
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [expenseForm, setExpenseForm] = useState<Partial<Expense>>({})

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

  async function saveGroup() {
    const min = Number(minKg || group.target_weight_min_kg)
    const max = Number(maxKg || group.target_weight_max_kg)
    await upsertRow('animal_groups', {
      ...group,
      name: name || group.name,
      status,
      target_weight_min_kg: min,
      target_weight_max_kg: max,
    })
    setEditingGroup(false)
    refresh()
  }

  async function deleteGroup() {
    if (!confirm(`Gruppe "${group.name}" wirklich löschen?`)) return
    await softDeleteRow('animal_groups', group.id)
    navigate('/gruppen')
  }

  async function saveFeed(f: FeedRecord) {
    await upsertRow('feed_records', { ...f, ...feedForm })
    setEditingFeedId(null)
    refresh()
  }

  async function deleteFeed(f: FeedRecord) {
    if (!confirm('Diesen Futtereintrag wirklich löschen?')) return
    await softDeleteRow('feed_records', f.id)
    refresh()
  }

  async function saveExpense(e: Expense) {
    await upsertRow('expenses', { ...e, ...expenseForm })
    setEditingExpenseId(null)
    refresh()
  }

  async function deleteExpense(e: Expense) {
    if (!confirm('Diesen Kosteneintrag wirklich löschen?')) return
    await softDeleteRow('expenses', e.id)
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
          <h2 className="text-sm font-semibold text-gray-600">Gruppendaten</h2>
          {!editingGroup && (
            <button
              className="text-sm text-brand-700"
              onClick={() => {
                setName(group.name)
                setStatus(group.status)
                setMinKg(String(group.target_weight_min_kg))
                setMaxKg(String(group.target_weight_max_kg))
                setEditingGroup(true)
              }}
            >
              Bearbeiten
            </button>
          )}
        </div>
        {editingGroup ? (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as GroupStatus)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              >
                {GROUP_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">Zielgewicht</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={minKg}
                  onChange={(e) => setMinKg(e.target.value)}
                  className="w-24 rounded border border-gray-300 px-2 py-2 text-base"
                />
                <span className="text-gray-500">–</span>
                <input
                  type="number"
                  step="0.1"
                  value={maxKg}
                  onChange={(e) => setMaxKg(e.target.value)}
                  className="w-24 rounded border border-gray-300 px-2 py-2 text-base"
                />
                <span className="text-gray-500">kg</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveGroup}
                className="rounded bg-brand-700 px-3 py-2 text-sm font-medium text-white"
              >
                Speichern
              </button>
              <button
                onClick={() => setEditingGroup(false)}
                className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <p className="text-lg text-gray-800">
            Zielgewicht: {group.target_weight_min_kg} – {group.target_weight_max_kg} kg
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
            {feed.map((f) =>
              editingFeedId === f.id ? (
                <li key={f.id} className="space-y-2 py-2 text-sm">
                  <input
                    type="text"
                    value={feedForm.feed_type ?? f.feed_type}
                    onChange={(e) => setFeedForm((s) => ({ ...s, feed_type: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                    placeholder="Futterart"
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={feedForm.date ?? f.date}
                      onChange={(e) => setFeedForm((s) => ({ ...s, date: e.target.value }))}
                      className="rounded border border-gray-300 px-2 py-1"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={feedForm.quantity ?? f.quantity}
                      onChange={(e) => setFeedForm((s) => ({ ...s, quantity: Number(e.target.value) }))}
                      className="w-24 rounded border border-gray-300 px-2 py-1"
                      placeholder="Menge"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={feedForm.cost_total ?? f.cost_total ?? ''}
                      onChange={(e) =>
                        setFeedForm((s) => ({ ...s, cost_total: e.target.value ? Number(e.target.value) : null }))
                      }
                      className="w-24 rounded border border-gray-300 px-2 py-1"
                      placeholder="Kosten"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveFeed(f)}
                      className="rounded bg-brand-700 px-3 py-1 text-white"
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingFeedId(null)}
                      className="rounded border border-gray-300 px-3 py-1 text-gray-700"
                    >
                      Abbrechen
                    </button>
                  </div>
                </li>
              ) : (
                <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium text-gray-800">{f.feed_type}</div>
                    <div className="text-gray-500">
                      {fmtDate(f.date)} · {num(f.quantity)} {f.unit}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-700">{f.cost_total != null ? fmtChf(f.cost_total) : '–'}</span>
                    <span className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-brand-700"
                        onClick={() => {
                          setFeedForm(f)
                          setEditingFeedId(f.id)
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button type="button" className="text-red-600" onClick={() => deleteFeed(f)}>
                        Löschen
                      </button>
                    </span>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          Sonstige Kosten {totalExpenses > 0 && `· Total ${fmtChf(totalExpenses)}`}
        </h2>
        {expenses.length > 0 && (
          <ul className="mb-3 divide-y">
            {expenses.map((e) =>
              editingExpenseId === e.id ? (
                <li key={e.id} className="space-y-2 py-2 text-sm">
                  <input
                    type="text"
                    value={expenseForm.category ?? e.category}
                    onChange={(ev) => setExpenseForm((s) => ({ ...s, category: ev.target.value }))}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                    placeholder="Kategorie"
                  />
                  <input
                    type="text"
                    value={expenseForm.description ?? e.description ?? ''}
                    onChange={(ev) => setExpenseForm((s) => ({ ...s, description: ev.target.value || null }))}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                    placeholder="Beschreibung"
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={expenseForm.date ?? e.date}
                      onChange={(ev) => setExpenseForm((s) => ({ ...s, date: ev.target.value }))}
                      className="rounded border border-gray-300 px-2 py-1"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={expenseForm.amount ?? e.amount}
                      onChange={(ev) => setExpenseForm((s) => ({ ...s, amount: Number(ev.target.value) }))}
                      className="w-24 rounded border border-gray-300 px-2 py-1"
                      placeholder="Betrag"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveExpense(e)}
                      className="rounded bg-brand-700 px-3 py-1 text-white"
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingExpenseId(null)}
                      className="rounded border border-gray-300 px-3 py-1 text-gray-700"
                    >
                      Abbrechen
                    </button>
                  </div>
                </li>
              ) : (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium text-gray-800">{e.category}</div>
                    <div className="text-gray-500">
                      {fmtDate(e.date)} {e.description ? `· ${e.description}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-700">{fmtChf(e.amount)}</span>
                    <span className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-brand-700"
                        onClick={() => {
                          setExpenseForm(e)
                          setEditingExpenseId(e.id)
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button type="button" className="text-red-600" onClick={() => deleteExpense(e)}>
                        Löschen
                      </button>
                    </span>
                  </div>
                </li>
              ),
            )}
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

      <section className="rounded-lg border border-red-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-red-700">Danger Zone</h2>
        <button
          type="button"
          onClick={deleteGroup}
          className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
        >
          Gruppe löschen
        </button>
      </section>
    </div>
  )
}
