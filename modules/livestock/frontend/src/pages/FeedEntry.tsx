import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { todayIso } from '../lib/format'
import type { FeedReference } from '../types'

interface GroupOption {
  id: string
  name: string
}

async function loadGroups(pg: PGlite): Promise<GroupOption[]> {
  const { rows } = await pg.query<GroupOption>(
    "select id, name from animal_groups where deleted_at is null and status = 'aktiv' order by created_date desc",
  )
  return rows
}
async function loadFeedReferences(pg: PGlite): Promise<FeedReference[]> {
  const { rows } = await pg.query<FeedReference>(
    'select * from feed_reference where deleted_at is null order by name',
  )
  return rows
}

export default function FeedEntry() {
  const { data: groups } = useQuery(loadGroups)
  const { data: feedRefs } = useQuery(loadFeedReferences)
  const [groupId, setGroupId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [feedType, setFeedType] = useState('')
  const matchedReference = feedRefs?.find(
    (r) => r.name.toLowerCase() === feedType.trim().toLowerCase(),
  )
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('kg')
  const [costTotal, setCostTotal] = useState('')
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId && groups && groups.length > 0) setGroupId(groups[0].id)
  }, [groups, groupId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedMsg(null)
    if (!groupId || !feedType || !quantity) {
      setError('Bitte Gruppe, Futterart und Menge angeben.')
      return
    }
    setSaving(true)
    try {
      await upsertRow('feed_records', {
        id: crypto.randomUUID(),
        group_id: groupId,
        date,
        feed_type: feedType,
        quantity: Number(quantity),
        unit,
        cost_total: costTotal ? Number(costTotal) : null,
        supplier: supplier || null,
        notes: notes || null,
      })
      setSavedMsg('Futtereintrag gespeichert.')
      setFeedType('')
      setQuantity('')
      setCostTotal('')
      setSupplier('')
      setNotes('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Futter erfassen</h1>
      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <Field label="Gruppe">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          >
            <option value="">Bitte wählen…</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Datum">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Futterart">
          <input
            type="text"
            list="feed-names"
            value={feedType}
            onChange={(e) => setFeedType(e.target.value)}
            placeholder="z.B. UFA 867"
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
          <datalist id="feed-names">
            {(feedRefs ?? []).map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
          {matchedReference && (
            <p className="mt-1 text-xs text-gray-500">
              {[
                matchedReference.crude_protein_pct != null && `Rohprotein ${matchedReference.crude_protein_pct}%`,
                matchedReference.energy_mj != null && `Energie ${matchedReference.energy_mj} MJ`,
              ]
                .filter(Boolean)
                .join(' · ') || 'Referenzeintrag gefunden'}
            </p>
          )}
          <Link to="/futter/referenz" className="mt-1 inline-block text-xs text-brand-700">
            Referenz verwalten →
          </Link>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Menge">
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            />
          </Field>
          <Field label="Einheit">
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            >
              <option value="kg">kg</option>
              <option value="dt">dt</option>
              <option value="Ballen">Ballen</option>
              <option value="Liter">Liter</option>
            </select>
          </Field>
        </div>
        <Field label="Kosten total (CHF, optional)">
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={costTotal}
            onChange={(e) => setCostTotal(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Lieferant (optional)">
          <input
            type="text"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Notizen (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {savedMsg && <p className="text-sm text-green-700">{savedMsg}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white active:bg-brand-800 disabled:opacity-50"
        >
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}
