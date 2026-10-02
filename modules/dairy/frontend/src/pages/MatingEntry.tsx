import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import AnimalPicker from '../components/AnimalPicker'
import SireSelect, { EMPTY_SIRE, type SireValue } from '../components/SireSelect'
import { loadSireOptions } from '../lib/sires'
import { animalKey } from '@fmis/core/earTag'
import { isoDate, localTodayIso } from '../lib/format'
import { speciesOf, speciesTerms } from '../lib/species'
import type { Animal } from '../types'

async function loadData(pg: PGlite) {
  const [animals, sires, lastBirths, matings] = await Promise.all([
    pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w' order by lauf_nr nulls last, ear_tag"),
    loadSireOptions(pg),
    pg.query<{ dam_id: string; last_birth: unknown }>('select dam_id, max(birth_date) as last_birth from births where deleted_at is null group by dam_id'),
    pg.query<{ animal_id: string; service_date: unknown }>('select animal_id, service_date from matings where deleted_at is null'),
  ])
  return {
    females: animals.rows,
    sires,
    lastBirth: new Map(lastBirths.rows.map((b) => [b.dam_id, isoDate(b.last_birth)])),
    matings: matings.rows.map((m) => ({ animal_id: m.animal_id, service_date: isoDate(m.service_date)! })),
  }
}

/** Belegung (Natursprung, bei Schafen meist als Zeitraum mit einem Widder)
 * bzw. Besamung erfassen — für ein Tier oder eine ganze Gruppe. Die Daten
 * der KB bei Kühen kommen weiterhin auch mit dem Herdebuch-Export. */
export default function MatingEntry({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const terms = speciesTerms(moduleKey)
  const { data, refresh } = useQuery(loadData)
  const [ids, setIds] = useState<string[]>([])
  const [sire, setSire] = useState<SireValue>(EMPTY_SIRE)
  const [kind, setKind] = useState<'natursprung' | 'kb'>(species === 'sheep' ? 'natursprung' : 'kb')
  const [from, setFrom] = useState(localTodayIso)
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  const females = data?.females ?? []
  const byId = useMemo(() => new Map(females.map((a) => [a.id, a])), [females])

  async function save() {
    if (!data || ids.length === 0) return setError(`Zuerst ${terms.plural} wählen.`)
    const sireKey = sire.key ?? animalKey(sire.ear_tag)
    if (!sireKey && !sire.name.trim()) return setError('Vatertier angeben.')
    if (to && to < from) return setError('"bis" liegt vor "von".')
    setSaving(true)
    setError(null)
    try {
      await inTransaction(db, async (tx) => {
        for (const id of ids) {
          const animal = byId.get(id)!
          const damKey = animalKey(animal.ear_tag) ?? animal.ear_tag
          const last = data.lastBirth.get(id) ?? null
          // Laufende Nummer der Belegung seit der letzten Geburt — wie im
          // Herdebuch (K10 89–90), damit der Schlüssel eines späteren Imports
          // derselben Belegung übereinstimmt.
          const seq = data.matings.filter((m) => m.animal_id === id && (!last || m.service_date > last)).length + 1
          await upsertRow(tx, 'matings', {
            id: crypto.randomUUID(),
            animal_id: id,
            service_date: from,
            service_to: to || null,
            kind,
            seq,
            sire_key: sireKey,
            sire_ear_tag: sire.ear_tag.trim() || null,
            sire_name: sire.name.trim() || null,
            sire_breed: null,
            source: 'manual',
            import_key: `${damKey}|${from}|${seq}|${sireKey ?? ''}`,
            notes: notes.trim() || null,
          })
        }
      })
      setSaved(ids.length)
      setIds([])
      setNotes('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base'

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">{species === 'sheep' ? 'Belegung' : 'Besamung / Belegung'} erfassen</h1>
      {saved != null && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">Für {saved} {saved === 1 ? terms.singular : terms.plural} gespeichert.</div>}

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm text-gray-600">{terms.plural}</div>
        <AnimalPicker animals={females} selected={ids} onChange={setIds} multiple />
      </div>

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <SireSelect label={species === 'sheep' ? 'Widder' : 'Stier'} options={data?.sires ?? []} value={sire} onChange={setSire} />
        <div className="flex gap-2">
          {(['natursprung', 'kb'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded-lg py-2.5 text-base ${kind === k ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              {k === 'kb' ? 'KB' : 'Natursprung'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm text-gray-600">
            {to ? 'von' : 'Datum'}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="block text-sm text-gray-600">
            bis (Zeitraum, optional)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
        </div>
        <label className="block text-sm text-gray-600">
          Bemerkung
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || ids.length === 0}
        className="w-full rounded-lg bg-brand-700 py-3.5 text-base font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Speichere…' : ids.length > 1 ? `Für ${ids.length} ${terms.plural} speichern` : 'Speichern'}
      </button>
    </div>
  )
}
