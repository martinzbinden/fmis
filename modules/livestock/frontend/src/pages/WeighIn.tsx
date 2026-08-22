import { useEffect, useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { todayIso, num } from '../lib/format'

interface GroupOption {
  id: string
  name: string
}

interface AnimalRow {
  animal_id: string
  ear_tag: string
  last_weight: unknown
}

async function loadGroups(pg: PGlite): Promise<GroupOption[]> {
  const { rows } = await pg.query<GroupOption>(
    "select id, name from animal_groups where deleted_at is null and status = 'aktiv' order by created_date desc",
  )
  return rows
}

function loadAnimalsForGroup(groupId: string | null) {
  return async (pg: PGlite): Promise<AnimalRow[]> => {
    if (!groupId) return []
    const { rows } = await pg.query<AnimalRow>(
      `select a.id as animal_id, a.ear_tag,
              w_last.weight_kg as last_weight
       from group_memberships gm
       join animals a on a.id = gm.animal_id and a.deleted_at is null and a.status = 'aktiv'
       left join lateral (
         select weight_kg from weighings w
         where w.animal_id = a.id and w.deleted_at is null
         order by w.date desc, w.updated_at desc limit 1
       ) w_last on true
       where gm.group_id = $1 and gm.deleted_at is null and gm.end_date is null
       order by a.ear_tag`,
      [groupId],
    )
    return rows
  }
}

export default function WeighIn() {
  const { data: groups, loading: groupsLoading } = useQuery(loadGroups)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [weights, setWeights] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId && groups && groups.length > 0) setGroupId(groups[0].id)
  }, [groups, groupId])

  const { data: animals, loading: animalsLoading } = useQuery(loadAnimalsForGroup(groupId), [groupId])

  const filledCount = useMemo(
    () => Object.values(weights).filter((v) => v.trim() !== '').length,
    [weights],
  )

  async function handleSave() {
    if (!animals) return
    setSaving(true)
    setSavedMsg(null)
    try {
      let count = 0
      for (const a of animals) {
        const raw = weights[a.animal_id]
        if (!raw || raw.trim() === '') continue
        const weightKg = Number(raw)
        if (Number.isNaN(weightKg) || weightKg <= 0) continue
        await upsertRow('weighings', {
          id: crypto.randomUUID(),
          animal_id: a.animal_id,
          date,
          weight_kg: weightKg,
          notes: null,
        })
        count++
      }
      setWeights({})
      setSavedMsg(`${count} Wägungen gespeichert.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-32">
      <h1 className="text-xl font-bold text-gray-800">Gewichte erfassen</h1>

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Gruppe</label>
          <select
            value={groupId ?? ''}
            onChange={(e) => setGroupId(e.target.value || null)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          >
            {groupsLoading && <option>Lädt…</option>}
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Datum</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </div>
      </div>

      {animalsLoading && <p className="text-center text-gray-400">Lädt Tiere…</p>}

      {groups && groups.length === 0 && (
        <p className="text-center text-gray-500">Keine aktiven Gruppen vorhanden.</p>
      )}

      {animals && animals.length === 0 && groupId && !animalsLoading && (
        <p className="text-center text-gray-500">Keine aktiven Tiere in dieser Gruppe.</p>
      )}

      <ul className="space-y-2">
        {(animals ?? []).map((a) => (
          <li key={a.animal_id} className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
            <div className="flex-1">
              <div className="font-semibold text-gray-800">{a.ear_tag}</div>
              {a.last_weight != null && (
                <div className="text-xs text-gray-500">zuletzt {num(a.last_weight)} kg</div>
              )}
            </div>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="kg"
              value={weights[a.animal_id] ?? ''}
              onChange={(e) => setWeights((w) => ({ ...w, [a.animal_id]: e.target.value }))}
              className="w-28 rounded border border-gray-300 px-3 py-3 text-right text-xl font-semibold"
            />
          </li>
        ))}
      </ul>

      {animals && animals.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-10 border-t bg-white p-3">
          <div className="mx-auto max-w-2xl">
            {savedMsg && <p className="mb-2 text-center text-sm text-green-700">{savedMsg}</p>}
            <button
              onClick={handleSave}
              disabled={saving || filledCount === 0}
              className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white active:bg-brand-800 disabled:opacity-50"
            >
              {saving ? 'Speichert…' : `${filledCount} Gewichte speichern`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
