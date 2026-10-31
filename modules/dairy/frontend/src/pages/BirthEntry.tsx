import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { animalKey, animalLabel, shortEarTag } from '@fmis/core/earTag'
import { matchRead, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'
import { useQuery } from '../hooks/useQuery'
import { inTransaction } from '../db/transaction'
import AnimalPicker from '../components/AnimalPicker'
import AnimalWarnings from '../components/AnimalWarnings'
import { animalWarnings, eventsOf, loadAnimalEvents } from '../lib/animalWarnings'
import SireSelect, { EMPTY_SIRE, type SireValue } from '../components/SireSelect'
import { loadSireOptions } from '../lib/sires'
import { recordBirth, validateBirth, type OffspringFate, type OffspringInput } from '../lib/recordBirth'
import { loadPendingOffspring } from '../lib/earTagPending'
import { fmtDate, isoDate, localTodayIso, num } from '../lib/format'
import { speciesOf } from '../lib/species'
import type { Animal } from '../types'

async function loadData(pg: PGlite) {
  const [animals, sires, lastMatings, births, pending, events] = await Promise.all([
    pg.query<Animal>('select * from animals where deleted_at is null order by lauf_nr nulls last, ear_tag'),
    loadSireOptions(pg),
    pg.query<{ animal_id: string; service_date: unknown; sire_key: string | null; sire_ear_tag: string | null; sire_name: string | null }>(
      `select distinct on (animal_id) animal_id, service_date, sire_key, sire_ear_tag, sire_name
       from matings where deleted_at is null order by animal_id, service_date desc`,
    ),
    pg.query<{ dam_id: string; birth_date: unknown; parity: unknown }>(
      'select dam_id, birth_date, parity from births where deleted_at is null',
    ),
    loadPendingOffspring(pg),
    loadAnimalEvents(pg),
  ])
  return {
    events,
    animals: animals.rows,
    sires,
    lastMating: new Map(lastMatings.rows.map((m) => [m.animal_id, { ...m, service_date: isoDate(m.service_date)! }])),
    births: births.rows.map((b) => ({ dam_id: b.dam_id, birth_date: isoDate(b.birth_date)!, parity: num(b.parity) })),
    pendingCount: pending.length,
  }
}

const EMPTY_OFFSPRING: OffspringInput = { ear_tag: '', sex: null, fate: 'lebend', birth_weight_kg: null, tag_later: false }

const FATES: { key: OffspringFate; label: string }[] = [
  { key: 'lebend', label: 'lebend' },
  { key: 'totgeboren', label: 'tot geboren' },
  { key: 'verendet', label: 'verendet < 24 h' },
]

export default function BirthEntry({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const word = species === 'sheep' ? { event: 'Ablammung', young: 'Lamm', youngPl: 'Lämmer', mother: 'Aue' } : { event: 'Abkalbung', young: 'Kalb', youngPl: 'Kälber', mother: 'Kuh' }
  const { data, refresh } = useQuery(loadData)
  const [damIds, setDamIds] = useState<string[]>([])
  const [date, setDate] = useState(localTodayIso)
  const [sire, setSire] = useState<SireValue>(EMPTY_SIRE)
  const [ease, setEase] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [offspring, setOffspring] = useState<OffspringInput[]>([{ ...EMPTY_OFFSPRING }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ damId: string; count: number; later: number } | null>(null)

  const females = useMemo(() => (data?.animals ?? []).filter((a) => a.status === 'aktiv' && a.sex !== 'm'), [data])
  const dam = females.find((a) => a.id === damIds[0])
  const damBirths = useMemo(() => (data?.births ?? []).filter((b) => b.dam_id === dam?.id), [data, dam])
  const lastBirth = damBirths.map((b) => b.birth_date).sort().at(-1) ?? null
  const mating = dam ? data?.lastMating.get(dam.id) : undefined
  const matingSinceBirth = mating && (!lastBirth || mating.service_date > lastBirth) ? mating : undefined

  // Vater aus der letzten Belegung seit der letzten Geburt vorbelegen.
  useEffect(() => {
    if (matingSinceBirth?.sire_key) {
      setSire({ key: matingSinceBirth.sire_key, ear_tag: matingSinceBirth.sire_ear_tag ?? matingSinceBirth.sire_key, name: matingSinceBirth.sire_name ?? '' })
    } else {
      setSire(EMPTY_SIRE)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dam?.id])

  function setCount(n: number) {
    setOffspring((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? { ...EMPTY_OFFSPRING }))
  }
  function patch(i: number, p: Partial<OffspringInput>) {
    setOffspring((prev) => prev.map((o, j) => (j === i ? { ...o, ...p } : o)))
  }

  // Lesegerät: zuerst die Mutter, danach füllt jede Lesung die nächste freie Ohrmarke.
  const reader = useTagReader({
    moduleKey,
    duplicate: (read) => {
      const m = matchRead(read, females)
      if (dam && m?.id === dam.id) return `${word.mother} ${animalLabel(dam)} schon gewählt`
      if (read.key && offspring.some((o) => animalKey(o.ear_tag) === read.key)) return `bei den ${word.youngPl} schon eingetragen`
      return null
    },
    onRead: (read) => {
      const known = matchRead(read, data?.animals ?? [])
      if (!dam) {
        const m = matchRead(read, females)
        if (!m) return { text: `${shortEarTag(read.earTag)}: keine aktive ${word.mother} – zuerst die ${word.mother} lesen`, tone: 'error' }
        setDamIds([m.id])
        return `${word.mother}: ${animalLabel(m)} – jetzt die ${word.youngPl} lesen`
      }
      if (known && isoDate(known.birth_date) !== date) return { text: `${animalLabel(known)} ist schon im Bestand (geb. ${fmtDate(isoDate(known.birth_date))}) – nicht als ${word.young}`, tone: 'error' }
      const slot = offspring.findIndex((o) => o.fate === 'lebend' && !o.tag_later && !o.ear_tag.trim())
      if (slot >= 0) {
        patch(slot, { ear_tag: read.earTag })
        return `${word.young} ${slot + 1}: ${shortEarTag(read.earTag)}`
      }
      if (offspring.length >= 4) return { text: `Schon 4 ${word.youngPl} – Ohrmarke von Hand eintragen`, tone: 'error' }
      setOffspring((prev) => [...prev, { ...EMPTY_OFFSPRING, ear_tag: read.earTag }])
      return `${word.young} ${offspring.length + 1}: ${shortEarTag(read.earTag)}`
    },
  })
  const damWarnings = dam && data ? animalWarnings(dam.id, eventsOf(data.events, dam.id), { kind: 'birth', date }, species) : []

  async function save() {
    if (!dam || !data) return setError(`Zuerst die ${word.mother} wählen.`)
    if (damBirths.some((b) => b.birth_date === date)) return setError(`Für diese ${word.mother} ist am ${date} schon eine ${word.event} erfasst.`)
    const input = {
      dam,
      birth_date: date,
      sire,
      ease,
      conception_date: matingSinceBirth?.service_date ?? null,
      parity: Math.max(0, ...damBirths.map((b) => b.parity ?? 0)) + 1,
      notes: notes.trim() || null,
      offspring,
    }
    const problem = validateBirth(input, data.animals)
    if (problem) return setError(problem)
    setSaving(true)
    setError(null)
    try {
      const result = await inTransaction(db, (tx) => recordBirth(tx, input))
      setDone({ damId: dam.id, count: result.newAnimalIds.length, later: offspring.filter((o) => o.fate === 'lebend' && o.tag_later && !o.ear_tag.trim()).length })
      setDamIds([])
      setOffspring([{ ...EMPTY_OFFSPRING }])
      setNotes('')
      setEase(null)
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
      <h1 className="text-xl font-bold text-gray-800">{word.event} erfassen</h1>

      {(data?.pendingCount ?? 0) > 0 && (
        <Link to="../ohrmarken" relative="path" className="flex min-h-11 items-center justify-between gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            🏷️ <b>{data!.pendingCount}</b> {data!.pendingCount === 1 ? word.young : word.youngPl} ohne Ohrmarke
          </span>
          <span className="font-semibold">nachtragen ›</span>
        </Link>
      )}

      {done && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Gespeichert{done.count > 0 ? ` — ${done.count} ${done.count === 1 ? word.young : word.youngPl} im Bestand angelegt` : ''}.{' '}
          {done.later > 0 && (
            <>
              {done.later} {done.later === 1 ? word.young : word.youngPl} ohne Ohrmarke → Pendenz.{' '}
            </>
          )}
          <Link to={`../kuehe/${done.damId}`} relative="path" className="font-medium text-brand-700">
            Zur {word.mother}
          </Link>
          <div className="mt-1 text-xs text-green-800">Die Geburtsmeldung an die TVD bleibt wie bisher separat.</div>
        </div>
      )}

      <TagReaderButton reader={reader} hint={`erst ${word.mother}, dann ${word.youngPl}`} />

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm text-gray-600">{word.mother}</div>
        <AnimalPicker animals={females} selected={damIds} onChange={setDamIds} />
        {damWarnings.length > 0 && (
          <div className="mt-2">
            <AnimalWarnings animalIds={[dam!.id]} warnings={damWarnings} />
          </div>
        )}
        {dam && (
          <p className="mt-2 text-xs text-gray-500">
            {lastBirth ? `Letzte ${word.event} ${lastBirth.split('-').reverse().join('.')}` : `Noch keine ${word.event} erfasst`}
            {matingSinceBirth ? ` · belegt ${matingSinceBirth.service_date.split('-').reverse().join('.')}` : ''}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <label className="block text-sm text-gray-600">
          Datum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <SireSelect label="Vater" options={data?.sires ?? []} value={sire} onChange={setSire} />
        {species === 'cattle' && (
          <label className="block text-sm text-gray-600">
            Geburtsverlauf
            <select value={ease ?? ''} onChange={(e) => setEase(e.target.value ? Number(e.target.value) : null)} className={input}>
              <option value="">–</option>
              <option value="1">normal / ohne Hilfe</option>
              <option value="2">leichte Hilfe</option>
              <option value="3">schwer</option>
              <option value="4">Kaiserschnitt</option>
            </select>
          </label>
        )}
      </div>

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">{word.youngPl}</span>
          <div className="flex overflow-hidden rounded-lg border border-gray-300">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`px-4 py-2 text-base font-semibold ${offspring.length === n ? 'bg-brand-700 text-white' : 'text-gray-700'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {offspring.map((o, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3">
            <div className="text-xs font-semibold text-gray-500">
              {word.young} {i + 1}
            </div>
            <div className="flex gap-2">
              {(['w', 'm'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => patch(i, { sex: s })}
                  className={`flex-1 rounded-lg py-2.5 text-base ${o.sex === s ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  {s === 'w' ? '♀ weiblich' : '♂ männlich'}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {FATES.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => patch(i, { fate: f.key })}
                  className={`flex-1 rounded-lg px-1 py-2 text-sm ${o.fate === f.key ? (f.key === 'lebend' ? 'bg-green-700 text-white' : 'bg-gray-700 text-white') : 'bg-gray-100 text-gray-700'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {o.fate === 'lebend' && (
              <button
                type="button"
                aria-pressed={!!o.tag_later}
                onClick={() => patch(i, { tag_later: !o.tag_later, ear_tag: '' })}
                className={`w-full rounded-lg py-2 text-sm ${o.tag_later ? 'bg-amber-500 font-semibold text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                🏷️ Ohrmarke später nachtragen
              </button>
            )}
            <div className="grid grid-cols-3 gap-2">
              {o.fate === 'lebend' && o.tag_later ? (
                <p className="col-span-2 content-center rounded-lg bg-amber-50 px-3 text-sm text-amber-900">Ohrmarke offen (Pendenz)</p>
              ) : (
                <input
                  value={o.ear_tag}
                  onChange={(e) => patch(i, { ear_tag: e.target.value })}
                  placeholder={o.fate === 'lebend' ? 'Ohrmarke' : 'Ohrmarke (falls markiert)'}
                  autoCapitalize="characters"
                  className={`col-span-2 ${input}`}
                />
              )}
              <input
                value={o.birth_weight_kg ?? ''}
                onChange={(e) => patch(i, { birth_weight_kg: e.target.value ? Number(e.target.value.replace(',', '.')) : null })}
                placeholder="kg"
                inputMode="decimal"
                className={input}
              />
            </div>
          </div>
        ))}
        <label className="block text-sm text-gray-600">
          Bemerkung
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dam}
        className="w-full rounded-lg bg-brand-700 py-3.5 text-base font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Speichere…' : `${word.event} speichern`}
      </button>
    </div>
  )
}
