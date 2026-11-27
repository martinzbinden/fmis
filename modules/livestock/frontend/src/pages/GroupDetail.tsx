import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { API_URL, getToken } from '@fmis/core/auth'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow, writeBatch } from '../db/write'
import { addEarTagsToGroup, type EarTagImportResult } from '../lib/importCsv'
import { fmtDate, fmtChf, num, todayIso } from '../lib/format'
import { countGroupDependents, groupDeleteBlocker, isoDay, loadGroupOptions, type GroupOption } from '../lib/groups'
import type { AnimalGroup, AnimalStatus, FeedRecord, Expense, GroupStatus } from '../types'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import { errorText, notifyError } from '@fmis/core/toast'
import PenButton from '../components/PenButton'

const GROUP_STATUS_OPTIONS: GroupStatus[] = ['aktiv', 'abgeschlossen']

interface Member {
  membership_id: string
  animal_id: string
  ear_tag: string
  status: AnimalStatus
  start_date: string
  end_date: string | null
}

interface Detail {
  group: AnimalGroup
  members: Member[]
  feed: FeedRecord[]
  expenses: Expense[]
  otherGroups: GroupOption[]
}

function loadDetail(id: string) {
  return async (pg: PGlite): Promise<Detail | null> => {
    const { rows: groupRows } = await pg.query<AnimalGroup>(
      'select * from animal_groups where id = $1 and deleted_at is null',
      [id],
    )
    if (groupRows.length === 0) return null

    // Aktive Tiere mit offener Mitgliedschaft zuerst, dann der Rest
    const { rows: members } = await pg.query<Member>(
      `select gm.id as membership_id, gm.animal_id, a.ear_tag, a.status, gm.start_date, gm.end_date
       from group_memberships gm
       join animals a on a.id = gm.animal_id and a.deleted_at is null
       where gm.group_id = $1 and gm.deleted_at is null
       order by (gm.end_date is null and a.status = 'aktiv') desc, gm.end_date desc nulls first, a.ear_tag`,
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
    const otherGroups = (await loadGroupOptions(pg)).filter((g) => g.id !== id)

    return { group: groupRows[0], members, feed, expenses, otherGroups }
  }
}

const smallBtn = 'min-h-11 rounded-lg px-3 text-sm'

export default function GroupDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const db = useDb()
  const { data, loading, refresh } = useQuery(loadDetail(id!), [id])

  const [minKg, setMinKg] = useState('')
  const [maxKg, setMaxKg] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<GroupStatus>('aktiv')
  const [editingGroup, setEditingGroup] = useState(false)
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null)

  const [expCategory, setExpCategory] = useState('')
  const [expDescription, setExpDescription] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expDate, setExpDate] = useState(todayIso())
  const [savingExpense, setSavingExpense] = useState(false)

  const [editingFeedId, setEditingFeedId] = useState<string | null>(null)
  const [feedForm, setFeedForm] = useState<Partial<FeedRecord>>({})
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [expenseForm, setExpenseForm] = useState<Partial<Expense>>({})

  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [memberDate, setMemberDate] = useState(todayIso())
  const [targetGroupId, setTargetGroupId] = useState('')

  if (loading && !data) return <div className="p-4 text-center text-gray-500">Lädt…</div>
  if (!data) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Gruppe nicht gefunden.</p>
        <Link to="/livestock/gruppen" className="mt-2 inline-block text-brand-700 underline">
          Zurück zur Liste
        </Link>
      </div>
    )
  }

  const { group, members, feed, expenses, otherGroups } = data
  const activeCount = members.filter((m) => !m.end_date && m.status === 'aktiv').length
  const q = `?gruppe=${encodeURIComponent(group.id)}`

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
    // Nur leere Gruppen löschen: Futter, Kosten und Mitgliedschaften würden
    // sonst auf eine ausgeblendete Gruppe zeigen.
    const blocker = groupDeleteBlocker(await countGroupDependents(db, group.id))
    if (blocker) {
      setDeleteBlocked(blocker)
      return
    }
    if (!confirm(`Gruppe «${group.name}» wirklich löschen?`)) return
    await softDeleteRow('animal_groups', group.id)
    navigate('/livestock/gruppen')
  }

  function startMemberEdit(m: Member) {
    setEditingMemberId(m.membership_id)
    setMemberDate(todayIso())
    setTargetGroupId('')
  }

  async function removeMember(m: Member) {
    const start = isoDay(m.start_date)
    const end = memberDate < start ? start : memberDate
    try {
      await upsertRow('group_memberships', { id: m.membership_id, end_date: end })
      setEditingMemberId(null)
    } catch (err) {
      notifyError(errorText(err))
    }
  }

  async function moveMember(m: Member) {
    if (!targetGroupId) return
    const start = isoDay(m.start_date)
    const day = memberDate < start ? start : memberDate
    try {
      // Alte Mitgliedschaft beenden und neue anlegen: ein Schreibvorgang
      await writeBatch(async (w) => {
        await w.upsert('group_memberships', { id: m.membership_id, end_date: day })
        await w.upsert('group_memberships', {
          id: crypto.randomUUID(),
          animal_id: m.animal_id,
          group_id: targetGroupId,
          start_date: day,
          end_date: null,
        })
      })
      setEditingMemberId(null)
    } catch (err) {
      notifyError(errorText(err))
    }
  }

  async function saveFeed(f: FeedRecord) {
    await upsertRow('feed_records', { ...f, ...feedForm })
    setEditingFeedId(null)
    refresh()
  }

  async function deleteFeed(f: FeedRecord) {
    if (!confirm('Diesen Futtereintrag wirklich löschen?')) return
    await softDeleteRow('feed_records', f.id)
    setEditingFeedId(null)
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
    setEditingExpenseId(null)
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
  const quickLink = 'inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm text-brand-700'

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <Link to="/livestock/gruppen" className="inline-flex min-h-10 items-center text-sm text-brand-700">
          ← Alle Gruppen
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-800">{group.name}</h1>
        <p className="text-sm text-gray-500">Angelegt am {fmtDate(group.created_date)} · {group.status}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to={`/livestock/futter${q}`} className={quickLink}>
            Futter erfassen
          </Link>
          <Link to={`/livestock/gewichte${q}`} className={quickLink}>
            Wägung
          </Link>
          <Link to={`/livestock/medikamente${q}`} className={quickLink}>
            Medikament
          </Link>
        </div>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Gruppendaten</h2>
          {!editingGroup && (
            <PenButton
              label="Gruppendaten bearbeiten"
              onClick={() => {
                setName(group.name)
                setStatus(group.status)
                setMinKg(String(group.target_weight_min_kg))
                setMaxKg(String(group.target_weight_max_kg))
                setEditingGroup(true)
              }}
            />
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
                <NumberInput
                  step="0.1"
                  value={minKg}
                  onChange={(e) => setMinKg(e.target.value)}
                  className="w-24 rounded border border-gray-300 px-2 py-2 text-base"
                />
                <span className="text-gray-500">–</span>
                <NumberInput
                  step="0.1"
                  value={maxKg}
                  onChange={(e) => setMaxKg(e.target.value)}
                  className="w-24 rounded border border-gray-300 px-2 py-2 text-base"
                />
                <span className="text-gray-500">kg</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={saveGroup} className={`${smallBtn} bg-brand-700 font-medium text-white`}>
                Speichern
              </button>
              <button onClick={() => setEditingGroup(false)} className={`${smallBtn} border border-gray-300 text-gray-700`}>
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
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          Mitglieder ({activeCount} aktiv{members.length !== activeCount ? `, ${members.length} insgesamt` : ''})
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">Keine Mitglieder.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => {
              const open = !m.end_date
              const gone = m.status !== 'aktiv'
              return (
                <li key={m.membership_id} className="py-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/livestock/tiere/${m.animal_id}`} className="inline-flex min-h-10 items-center font-medium text-brand-700">
                      {shortEarTag(m.ear_tag)}
                    </Link>
                    <span className="flex flex-1 flex-wrap items-center justify-end gap-x-2 text-right text-gray-500">
                      {gone && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{m.status}</span>
                      )}
                      <span>
                        {fmtDate(m.start_date)} – {m.end_date ? fmtDate(m.end_date) : gone ? 'nicht beendet' : 'aktiv'}
                      </span>
                    </span>
                    {open && editingMemberId !== m.membership_id && (
                      <PenButton label={`${shortEarTag(m.ear_tag)} bearbeiten`} onClick={() => startMemberEdit(m)} />
                    )}
                  </div>
                  {editingMemberId === m.membership_id && (
                    <div className="mb-2 space-y-2 rounded-lg border border-gray-200 p-3">
                      <label className="block">
                        <span className="mb-1 block text-xs text-gray-600">Datum</span>
                        <input
                          type="date"
                          value={memberDate}
                          onChange={(e) => setMemberDate(e.target.value)}
                          className="min-h-11 rounded border border-gray-300 px-2"
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={targetGroupId}
                          onChange={(e) => setTargetGroupId(e.target.value)}
                          className="min-h-11 flex-1 rounded border border-gray-300 px-2"
                          aria-label="Neue Gruppe"
                        >
                          <option value="">Gruppe wählen…</option>
                          {otherGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!targetGroupId}
                          onClick={() => void moveMember(m)}
                          className={`${smallBtn} bg-brand-700 font-medium text-white disabled:opacity-50`}
                        >
                          umteilen
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void removeMember(m)}
                          className={`${smallBtn} border border-red-300 text-red-700`}
                        >
                          aus Gruppe nehmen
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingMemberId(null)}
                          className={`${smallBtn} border border-gray-300 text-gray-700`}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <ReaderImportPanel groupId={group.id} onImported={refresh} />
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          Futtereinträge {totalFeedCost > 0 && `· Total ${fmtChf(totalFeedCost)}`}
        </h2>
        {feed.length === 0 ? (
          <p className="text-sm text-gray-500">
            Keine Einträge.{' '}
            <Link to={`/livestock/futter${q}`} className="inline-flex min-h-10 items-center text-brand-700">
              Futter erfassen
            </Link>
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
                    className="w-full rounded border border-gray-300 px-2 py-2"
                    placeholder="Futterart"
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="date"
                      value={feedForm.date ?? f.date}
                      onChange={(e) => setFeedForm((s) => ({ ...s, date: e.target.value }))}
                      className="rounded border border-gray-300 px-2 py-2"
                    />
                    <NumberInput
                      step="0.01"
                      value={feedForm.quantity ?? f.quantity}
                      onChange={(e) => setFeedForm((s) => ({ ...s, quantity: Number(e.target.value) }))}
                      className="w-24 rounded border border-gray-300 px-2 py-2"
                      placeholder="Menge"
                    />
                    <NumberInput
                      step="0.01"
                      value={feedForm.cost_total ?? f.cost_total ?? ''}
                      onChange={(e) =>
                        setFeedForm((s) => ({ ...s, cost_total: e.target.value ? Number(e.target.value) : null }))
                      }
                      className="w-24 rounded border border-gray-300 px-2 py-2"
                      placeholder="Kosten"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => saveFeed(f)} className={`${smallBtn} bg-brand-700 text-white`}>
                      Speichern
                    </button>
                    <button type="button" onClick={() => setEditingFeedId(null)} className={`${smallBtn} border border-gray-300 text-gray-700`}>
                      Abbrechen
                    </button>
                    <button type="button" onClick={() => deleteFeed(f)} className={`${smallBtn} ml-auto border border-red-300 text-red-700`}>
                      Löschen
                    </button>
                  </div>
                </li>
              ) : (
                <li key={f.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800">{f.feed_type}</div>
                    <div className="text-gray-500">
                      {fmtDate(f.date)} · {num(f.quantity)} {f.unit}
                    </div>
                  </div>
                  <span className="text-gray-700">{f.cost_total != null ? fmtChf(f.cost_total) : '–'}</span>
                  <PenButton
                    label="Futtereintrag bearbeiten"
                    onClick={() => {
                      setFeedForm(f)
                      setEditingFeedId(f.id)
                    }}
                  />
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
                    className="w-full rounded border border-gray-300 px-2 py-2"
                    placeholder="Kategorie"
                  />
                  <input
                    type="text"
                    value={expenseForm.description ?? e.description ?? ''}
                    onChange={(ev) => setExpenseForm((s) => ({ ...s, description: ev.target.value || null }))}
                    className="w-full rounded border border-gray-300 px-2 py-2"
                    placeholder="Beschreibung"
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="date"
                      value={expenseForm.date ?? e.date}
                      onChange={(ev) => setExpenseForm((s) => ({ ...s, date: ev.target.value }))}
                      className="rounded border border-gray-300 px-2 py-2"
                    />
                    <NumberInput
                      step="0.01"
                      value={expenseForm.amount ?? e.amount}
                      onChange={(ev) => setExpenseForm((s) => ({ ...s, amount: Number(ev.target.value) }))}
                      className="w-24 rounded border border-gray-300 px-2 py-2"
                      placeholder="Betrag"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => saveExpense(e)} className={`${smallBtn} bg-brand-700 text-white`}>
                      Speichern
                    </button>
                    <button type="button" onClick={() => setEditingExpenseId(null)} className={`${smallBtn} border border-gray-300 text-gray-700`}>
                      Abbrechen
                    </button>
                    <button type="button" onClick={() => deleteExpense(e)} className={`${smallBtn} ml-auto border border-red-300 text-red-700`}>
                      Löschen
                    </button>
                  </div>
                </li>
              ) : (
                <li key={e.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-800">{e.category}</div>
                    <div className="text-gray-500">
                      {fmtDate(e.date)} {e.description ? `· ${e.description}` : ''}
                    </div>
                  </div>
                  <span className="text-gray-700">{fmtChf(e.amount)}</span>
                  <PenButton
                    label="Kosteneintrag bearbeiten"
                    onClick={() => {
                      setExpenseForm(e)
                      setEditingExpenseId(e.id)
                    }}
                  />
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
          <NumberInput
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
        {deleteBlocked && <p className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-800">{deleteBlocked}</p>}
        <button
          type="button"
          onClick={() => void deleteGroup()}
          className="min-h-11 rounded border border-red-300 px-4 text-sm font-medium text-red-700"
        >
          Gruppe löschen
        </button>
      </section>
    </div>
  )
}

interface Datapool {
  group_id: string
  name: string | null
  count: number | null
  error?: string
}

/** APR600-Datenpool-Import: nur sichtbar wenn der Leser für livestock
 * aktiviert ist (Verwaltung → Module). Fügt ausschliesslich bereits
 * bekannte Tiere hinzu (siehe lib/importCsv.ts:addEarTagsToGroup) — der
 * Leser liefert keine Pflichtfelder wie Geschlecht, ein unbekanntes Tier
 * würde sonst mit fabrizierten Daten angelegt. */
function ReaderImportPanel({ groupId, onImported }: { groupId: string; onImported: () => void }) {
  const db = useDb()
  const [readerEnabled, setReaderEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [datapools, setDatapools] = useState<Datapool[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tags, setTags] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EarTagImportResult | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/livestock/reader/status`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((res) => res.json())
      .then((data: { enabled: boolean }) => setReaderEnabled(data.enabled))
      .catch(() => setReaderEnabled(false))
  }, [])

  async function loadDatapools() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/livestock/reader/datapools`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error(`Fehler ${res.status}`)
      setDatapools(await res.json())
    } catch (err) {
      setError(errorText(err, 'Datenpools konnten nicht geladen werden'))
    } finally {
      setBusy(false)
    }
  }

  async function loadTags(dp: Datapool) {
    setBusy(true)
    setError(null)
    setSelected(dp.group_id)
    try {
      const res = await fetch(`${API_URL}/livestock/reader/datapools/${dp.group_id}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error(`Fehler ${res.status}`)
      const rows: { ear_tag: string }[] = await res.json()
      setTags(rows.map((r) => r.ear_tag))
    } catch (err) {
      setError(errorText(err, 'Ohrmarken konnten nicht geladen werden'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (!tags) return
    setBusy(true)
    setError(null)
    try {
      const res = await addEarTagsToGroup(db, groupId, tags, todayIso())
      setResult(res)
      onImported()
    } catch (err) {
      setError(errorText(err, 'Import fehlgeschlagen'))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setOpen(false)
    setDatapools(null)
    setSelected(null)
    setTags(null)
    setResult(null)
    setError(null)
  }

  if (!readerEnabled) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          void loadDatapools()
        }}
        className="mt-3 w-full rounded border border-gray-300 py-2 text-sm text-gray-700"
      >
        📡 Ohrmarken vom Lesegerät importieren
      </button>
    )
  }

  return (
    <div className="mt-3 rounded border border-gray-200 p-3">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {result ? (
        <div className="space-y-1 text-sm">
          <p>{result.added} Tier(e) hinzugefügt.</p>
          {result.alreadyMember > 0 && <p className="text-gray-500">{result.alreadyMember} bereits Mitglied.</p>}
          {result.unmatched.length > 0 && (
            <p className="text-amber-700">
              {result.unmatched.length} unbekannte Ohrmarke(n) übersprungen (manuell nachtragen):{' '}
              {result.unmatched.join(', ')}
            </p>
          )}
          <button type="button" onClick={reset} className="mt-2 text-brand-700">
            Schliessen
          </button>
        </div>
      ) : tags ? (
        <div className="space-y-2 text-sm">
          <p>{tags.length} Ohrmarke(n) in diesem Datenpool.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void confirmImport()}
              disabled={busy}
              className="rounded bg-brand-700 px-3 py-1.5 text-white disabled:opacity-50"
            >
              {busy ? 'Importiere…' : 'In diese Gruppe importieren'}
            </button>
            <button type="button" onClick={reset} className="rounded border border-gray-300 px-3 py-1.5 text-gray-700">
              Abbrechen
            </button>
          </div>
        </div>
      ) : datapools ? (
        datapools.length === 0 ? (
          <p className="text-sm text-gray-500">Keine Datenpools auf dem Lesegerät gefunden.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {datapools.map((dp) => (
              <li key={dp.group_id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadTags(dp)}
                  className={`w-full rounded border px-3 py-1.5 text-left ${
                    selected === dp.group_id ? 'border-brand-700 bg-brand-50' : 'border-gray-300'
                  }`}
                >
                  {dp.name ?? dp.group_id} {dp.count != null && `(${dp.count})`}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-sm text-gray-500">Lädt…</p>
      )}
    </div>
  )
}
