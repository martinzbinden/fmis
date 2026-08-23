import { useEffect, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useEarTagFilter } from '../hooks/useEarTagFilter'
import EarTagFilterInput from '../components/EarTagFilterInput'
import { upsertRow } from '../db/write'
import { todayIso } from '../lib/format'

interface AnimalOption {
  id: string
  ear_tag: string
}
interface GroupOption {
  id: string
  name: string
}
interface GroupMember {
  animal_id: string
  ear_tag: string
}

async function loadAnimals(pg: PGlite): Promise<AnimalOption[]> {
  const { rows } = await pg.query<AnimalOption>(
    "select id, ear_tag from animals where deleted_at is null and status = 'aktiv' order by ear_tag",
  )
  return rows
}
async function loadGroups(pg: PGlite): Promise<GroupOption[]> {
  const { rows } = await pg.query<GroupOption>(
    "select id, name from animal_groups where deleted_at is null and status = 'aktiv' order by created_date desc",
  )
  return rows
}
function loadGroupMembers(groupId: string | null) {
  return async (pg: PGlite): Promise<GroupMember[]> => {
    if (!groupId) return []
    const { rows } = await pg.query<GroupMember>(
      `select a.id as animal_id, a.ear_tag from group_memberships gm
       join animals a on a.id = gm.animal_id and a.status = 'aktiv' and a.deleted_at is null
       where gm.group_id = $1 and gm.deleted_at is null and gm.end_date is null
       order by a.ear_tag`,
      [groupId],
    )
    return rows
  }
}

export default function MedicationEntry() {
  const [wholeGroup, setWholeGroup] = useState(false)
  const { data: animals } = useQuery(loadAnimals)
  const { data: groups } = useQuery(loadGroups)

  const [animalId, setAnimalId] = useState('')
  const [groupId, setGroupId] = useState('')
  const { data: members } = useQuery(loadGroupMembers(wholeGroup ? groupId || null : null), [
    wholeGroup,
    groupId,
  ])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { filter, setFilter, filtered: visibleMembers } = useEarTagFilter(members, (m) => m.ear_tag)

  // Bei Gruppenwechsel/-laden startet die Auswahl standardmässig mit allen
  // Mitgliedern — einzelne Tiere können danach gezielt abgewählt werden.
  useEffect(() => {
    setSelectedIds(new Set((members ?? []).map((m) => m.animal_id)))
  }, [members])

  function toggleMember(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = !!members && members.length > 0 && selectedIds.size === members.length
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set((members ?? []).map((m) => m.animal_id)))
  }

  const [date, setDate] = useState(todayIso())
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [reason, setReason] = useState('')
  const [withdrawalDays, setWithdrawalDays] = useState('0')
  const [administeredBy, setAdministeredBy] = useState('')
  const [cost, setCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedMsg(null)

    const targetIds = wholeGroup ? [...selectedIds] : animalId ? [animalId] : []
    if (targetIds.length === 0 || !name) {
      setError('Bitte Tier/Gruppe und Medikament angeben.')
      return
    }

    setSaving(true)
    try {
      for (const id of targetIds) {
        await upsertRow('medications', {
          id: crypto.randomUUID(),
          animal_id: id,
          date,
          medication_name: name,
          dose: dose || null,
          reason: reason || null,
          withdrawal_days: Number(withdrawalDays) || 0,
          administered_by: administeredBy || null,
          cost: cost ? Number(cost) : null,
        })
      }
      setSavedMsg(`Gespeichert für ${targetIds.length} Tier(e).`)
      setName('')
      setDose('')
      setReason('')
      setCost('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Medikamente erfassen</h1>

      <label className="flex items-center gap-3 rounded-lg bg-white p-4 shadow-sm">
        <input
          type="checkbox"
          checked={wholeGroup}
          onChange={(e) => setWholeGroup(e.target.checked)}
          className="h-5 w-5"
        />
        <span className="text-base font-medium text-gray-800">Auf ganze Gruppe anwenden</span>
      </label>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        {wholeGroup ? (
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

            {groupId && members && members.length > 0 && (
              <div className="mt-2 space-y-2">
                <EarTagFilterInput value={filter} onChange={setFilter} />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    {selectedIds.size} von {members.length} ausgewählt
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-medium text-brand-700"
                  >
                    {allSelected ? 'Alle abwählen' : 'Alle auswählen'}
                  </button>
                </div>
                <ul className="max-h-64 divide-y overflow-y-auto rounded border border-gray-200">
                  {(visibleMembers ?? []).map((m) => (
                    <li key={m.animal_id}>
                      <label className="flex items-center gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(m.animal_id)}
                          onChange={() => toggleMember(m.animal_id)}
                          className="h-5 w-5"
                        />
                        <span className="text-gray-800">{m.ear_tag}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {groupId && members && members.length === 0 && (
              <p className="mt-1 text-xs text-gray-500">Keine aktiven Tiere in dieser Gruppe.</p>
            )}
          </Field>
        ) : (
          <Field label="Tier">
            <select
              value={animalId}
              onChange={(e) => setAnimalId(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            >
              <option value="">Bitte wählen…</option>
              {(animals ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ear_tag}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Datum">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Medikament">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            placeholder="z.B. Baytril"
          />
        </Field>
        <Field label="Dosierung">
          <input
            type="text"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Grund">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Absetzfrist (Tage)">
          <input
            type="number"
            inputMode="numeric"
            value={withdrawalDays}
            onChange={(e) => setWithdrawalDays(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Verabreicht durch">
          <input
            type="text"
            value={administeredBy}
            onChange={(e) => setAdministeredBy(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Kosten (CHF, optional)">
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
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
