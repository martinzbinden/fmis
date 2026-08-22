import { useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
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
function loadGroupMemberIds(groupId: string | null) {
  return async (pg: PGlite): Promise<string[]> => {
    if (!groupId) return []
    const { rows } = await pg.query<{ animal_id: string }>(
      `select gm.animal_id from group_memberships gm
       join animals a on a.id = gm.animal_id and a.status = 'aktiv' and a.deleted_at is null
       where gm.group_id = $1 and gm.deleted_at is null and gm.end_date is null`,
      [groupId],
    )
    return rows.map((r) => r.animal_id)
  }
}

export default function MedicationEntry() {
  const [wholeGroup, setWholeGroup] = useState(false)
  const { data: animals } = useQuery(loadAnimals)
  const { data: groups } = useQuery(loadGroups)

  const [animalId, setAnimalId] = useState('')
  const [groupId, setGroupId] = useState('')
  const { data: memberIds } = useQuery(loadGroupMemberIds(wholeGroup ? groupId || null : null), [
    wholeGroup,
    groupId,
  ])

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

    const targetIds = wholeGroup ? memberIds ?? [] : animalId ? [animalId] : []
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
            {groupId && <p className="mt-1 text-xs text-gray-500">{(memberIds ?? []).length} Tiere betroffen</p>}
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
