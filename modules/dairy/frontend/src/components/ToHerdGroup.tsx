import { useEffect, useMemo, useState } from 'react'
import { animalProvider, type AnimalRef } from '@fmis/core/animals'
import { notifyError, notifySuccess } from '@fmis/core/toast'
import { constituteGroup, loadHerdData, memberAt, saveGroup, type HerdData } from '@fmis/tiere/lib/herds'
import type { HerdGroup } from '@fmis/tiere/types'
import { fmtDate, todayIso } from '../lib/format'
import { speciesOf } from '../lib/species'

/** Merkliste → Tiergruppe (Modul Tiere): die Tiere der Liste kommen ab einem Datum
 * in eine bestehende oder neue Gruppe und verlassen dabei ihre bisherige. «Neu
 * zusammenstellen» nimmt alle anderen aus der Gruppe — sie stehen danach «ohne Gruppe». */
export default function ToHerdGroup({ moduleKey, listName, animalIds, onDone }: { moduleKey: string; listName: string; animalIds: string[]; onDone: () => void }) {
  const species = speciesOf(moduleKey) === 'sheep' ? 'schafe' : 'rinder'
  const [data, setData] = useState<HerdData | null>(null)
  const [refs, setRefs] = useState<AnimalRef[] | null>(null)
  const [target, setTarget] = useState<string>('new')
  const [newName, setNewName] = useState(listName)
  const [replace, setReplace] = useState(true)
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadHerdData().then(setData)
    void (animalProvider(moduleKey)?.listAnimals() ?? Promise.resolve([])).then(setRefs)
  }, [moduleKey])

  const groups = useMemo(() => (data?.groups ?? []).filter((g) => g.species === species).sort((a, b) => Number(b.active) - Number(a.active) || a.sort_order - b.sort_order), [data, species])
  const group = groups.find((g) => g.id === target)
  const animals = useMemo(() => {
    const ids = new Set(animalIds)
    return (refs ?? []).filter((a) => ids.has(a.id))
  }, [refs, animalIds])
  const missing = animalIds.length - animals.length

  // Woher kommen die Tiere, wer verlässt die Gruppe?
  const preview = useMemo(() => {
    if (!data) return null
    const from = new Map<string, number>()
    for (const a of animals) {
      const m = memberAt(data, a.id, date)
      if (group && m?.group_id === group.id) continue
      const name = m ? (data.groups.find((g) => g.id === m.group_id)?.name ?? '?') : 'ohne Gruppe'
      from.set(name, (from.get(name) ?? 0) + 1)
    }
    const ids = new Set(animals.map((a) => a.id))
    const leaving = group && replace ? data.members.filter((m) => m.group_id === group.id && (m.to_date == null || m.to_date >= date) && !ids.has(m.animal_id)).length : 0
    return { from: [...from.entries()], leaving }
  }, [data, animals, group, replace, date])

  async function run() {
    if (!data || animals.length === 0) return
    if (target === 'new' && !newName.trim()) return
    setBusy(true)
    try {
      let g: HerdGroup
      if (group) {
        g = group.active ? group : { ...group, active: true }
        if (!group.active) await saveGroup(g)
      } else {
        g = {
          id: crypto.randomUUID(),
          name: newName.trim(),
          species,
          milking: false,
          active: true,
          sort_order: (data.groups.length + 1) * 10,
          notes: null,
          updated_at: '',
          deleted_at: null,
        }
        await saveGroup(g)
      }
      const { added, left } = await constituteGroup(data, { group: g, animals, date, replace: !!group && replace })
      notifySuccess(`«${g.name}»: ${added} Tiere dazu${left ? `, ${left} jetzt ohne Gruppe` : ''}`)
      onDone()
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const field = 'min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base'
  if (!data || !refs) return <p className="text-sm text-gray-600">Lädt…</p>
  return (
    <div className="space-y-3 rounded-lg bg-sky-50 p-3 text-sm">
      <div className="font-medium text-gray-900">{animals.length} Tiere in eine Tiergruppe überführen</div>
      <label className="block">
        <span className="mb-1 block text-gray-700">Gruppe</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={field}>
          <option value="new">+ neue Gruppe</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.active ? '' : ' (aufgelöst – wieder aktivieren)'}
            </option>
          ))}
        </select>
      </label>
      {target === 'new' && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name der neuen Gruppe" className={field} aria-label="Name der neuen Gruppe" />}
      {group && (
        <div className="space-y-1">
          <label className="flex items-start gap-2">
            <input type="radio" checked={replace} onChange={() => setReplace(true)} className="mt-1" />
            <span>
              <b>neu zusammenstellen</b> — genau diese Tiere; alle anderen verlassen die Gruppe und stehen «ohne Gruppe»
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={!replace} onChange={() => setReplace(false)} className="mt-1" />
            <span>
              <b>dazunehmen</b> — die bisherigen Tiere bleiben
            </span>
          </label>
        </div>
      )}
      <label className="flex items-center gap-2">
        <span className="text-gray-700">ab</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-2" />
      </label>
      {preview && (
        <ul className="list-disc pl-5 text-gray-800">
          {preview.from.map(([name, n]) => (
            <li key={name}>
              {n} aus «{name}»
            </li>
          ))}
          {preview.from.length === 0 && <li>alle schon in dieser Gruppe</li>}
          {preview.leaving > 0 && <li className="text-amber-800">{preview.leaving} {preview.leaving === 1 ? 'verlässt' : 'verlassen'} die Gruppe → «ohne Gruppe»</li>}
          {missing > 0 && <li className="text-gray-600">{missing} nicht mehr im Bestand – bleiben weg</li>}
        </ul>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || animals.length === 0 || (target === 'new' && !newName.trim())}
          onClick={() => void run()}
          className="min-h-11 flex-1 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'speichert …' : `Ab ${fmtDate(date)} überführen`}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 rounded-lg border border-gray-300 px-3">
          Abbrechen
        </button>
      </div>
    </div>
  )
}
