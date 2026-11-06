import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import AnimalPicker from '../components/AnimalPicker'
import AnimalWarnings from '../components/AnimalWarnings'
import { animalWarnings, eventsOf, loadAnimalEvents } from '../lib/animalWarnings'
import SireSelect, { EMPTY_SIRE, type SireValue } from '../components/SireSelect'
import { loadSireOptions } from '../lib/sires'
import { animalKey, animalLabel, shortEarTag } from '@fmis/core/earTag'
import { loadInbreeding } from '../lib/pedigreeData'
import { InbreedingBadge } from './AnimalDetail'
import { fmtDate, isoDate, localTodayIso } from '../lib/format'
import { recentMating } from '../lib/matingEntry'
import { speciesOf, speciesTerms } from '../lib/species'
import type { Animal } from '../types'
import { useOnUndo } from '@fmis/core/undo'
import { errorText } from '@fmis/core/toast'

const RECENT_LIST = 15

interface RecentRow {
  id: string
  service_date: unknown
  service_to: unknown
  kind: string | null
  sire_name: string | null
  sire_ear_tag: string | null
  ear_tag: string | null
  lauf_nr: string | null
  name: string | null
}

async function loadData(pg: PGlite) {
  const [animals, sires, lastBirths, matings, inbreeding, events, recent] = await Promise.all([
    pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w' order by lauf_nr nulls last, ear_tag"),
    loadSireOptions(pg, { presentOnly: true }),
    pg.query<{ dam_id: string; last_birth: unknown }>('select dam_id, max(birth_date) as last_birth from births where deleted_at is null group by dam_id'),
    pg.query<{ animal_id: string; service_date: unknown; service_to: unknown }>('select animal_id, service_date, service_to from matings where deleted_at is null'),
    loadInbreeding(pg),
    loadAnimalEvents(pg),
    pg.query<RecentRow>(
      `select m.id, m.service_date, m.service_to, m.kind, m.sire_name, m.sire_ear_tag, a.ear_tag, a.lauf_nr, a.name
       from matings m left join animals a on a.id = m.animal_id
       where m.deleted_at is null order by m.service_date desc, m.updated_at desc limit ${RECENT_LIST}`,
    ),
  ])
  return {
    events,
    females: animals.rows,
    sires,
    lastBirth: new Map(lastBirths.rows.map((b) => [b.dam_id, isoDate(b.last_birth)])),
    matings: matings.rows.map((m) => ({ animal_id: m.animal_id, service_date: isoDate(m.service_date)!, service_to: isoDate(m.service_to) })),
    inbreeding,
    recent: recent.rows,
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
  // ?tier=<id> (Aktionen auf der Tierseite) wählt das Tier vor
  const [ids, setIds] = useState<string[]>(() => {
    const t = new URLSearchParams(window.location.search).get('tier')
    return t ? [t] : []
  })
  const [sire, setSire] = useState<SireValue>(EMPTY_SIRE)
  const [kind, setKind] = useState<'natursprung' | 'kb'>(species === 'sheep' ? 'natursprung' : 'kb')
  const [from, setFrom] = useState(localTodayIso)
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  // nach «↶ Rückgängig» stimmt «Gespeichert» nicht mehr
  useOnUndo(() => {
    setSaved(null)
    setSkipped([])
  })

  const females = data?.females ?? []
  const byId = useMemo(() => new Map(females.map((a) => [a.id, a])), [females])
  const tierName = (id: string) => {
    const a = byId.get(id)!
    return `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${animalLabel(a)}`
  }
  // schon in den letzten 7 Tagen gemeldet: wird nicht gespeichert
  const duplicateText = (id: string) => {
    const hit = data ? recentMating(data.matings, id, from, to || null) : null
    return hit ? `${tierName(id)}: schon gemeldet am ${fmtDate(hit.service_date)}` : null
  }

  async function save() {
    if (!data || ids.length === 0) return setError(`Zuerst ${terms.plural} wählen.`)
    const sireKey = sire.key ?? animalKey(sire.ear_tag)
    if (!sireKey && !sire.name.trim()) return setError('Vatertier angeben.')
    if (to && to < from) return setError('"bis" liegt vor "von".')
    if (from > localTodayIso()) return setError('Das Datum liegt in der Zukunft.')
    const duplicates = ids.map(duplicateText).filter((t): t is string => t != null)
    const toSave = ids.filter((id) => duplicateText(id) == null)
    setSaving(true)
    setError(null)
    try {
      await inTransaction(db, async (tx) => {
        for (const id of toSave) {
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
      setSaved(toSave.length > 0 ? toSave.length : null)
      setSkipped(duplicates)
      setIds([])
      setNotes('')
      refresh()
    } catch (err) {
      setError(errorText(err, 'Speichern fehlgeschlagen'))
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
        <AnimalPicker animals={females} selected={ids} onChange={setIds} multiple readerModule={moduleKey} />
        {data &&
          ids.map((id) => {
            const duplicate = duplicateText(id)
            if (duplicate) return <p key={id} className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-medium text-amber-900">⚠ {duplicate}. Wird nicht nochmals gemeldet.</p>
            const warnings = animalWarnings(id, eventsOf(data.events, id), { kind: 'mating', date: from }, species)
            if (warnings.length === 0) return null
            return (
              <div key={id} className="mt-2">
                <div className="text-sm font-semibold text-gray-800">
                  {byId.get(id)!.lauf_nr ? `${byId.get(id)!.lauf_nr} · ` : ''}
                  {animalLabel(byId.get(id)!)}
                </div>
                <AnimalWarnings animalIds={[id]} warnings={warnings} />
              </div>
            )
          })}
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
            <input type="date" value={from} max={localTodayIso()} onChange={(e) => setFrom(e.target.value)} className={input} />
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

      {data && ids.length > 0 && (sire.key ?? animalKey(sire.ear_tag)) && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-1 text-sm text-gray-600">Erwartete Inzucht der Nachkommen</div>
          <ul className="divide-y text-sm">
            {ids.map((id) => {
              const a = byId.get(id)!
              const f = data.inbreeding.offspring(animalKey(a.ear_tag), sire.key ?? animalKey(sire.ear_tag))
              return (
                <li key={id} className="flex items-center justify-between py-1.5">
                  <span>{animalLabel(a)}</span>
                  <InbreedingBadge f={f} />
                </li>
              )
            })}
          </ul>
          {ids.some((id) => data.inbreeding.offspring(animalKey(byId.get(id)!.ear_tag), sire.key ?? animalKey(sire.ear_tag)) >= 0.0625) && (
            <p className="mt-2 text-sm font-medium text-red-700">⚠ Mindestens eine Anpaarung liegt bei 6.25 % oder mehr.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || ids.length === 0}
        className="w-full rounded-lg bg-brand-700 py-3.5 text-base font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Speichere…' : ids.length > 1 ? `Für ${ids.length} ${terms.plural} speichern` : 'Speichern'}
      </button>
      {skipped.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Nicht gemeldet, in den letzten 7 Tagen schon erfasst:</p>
          <ul className="mt-1 space-y-0.5">
            {skipped.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {data && data.recent.length > 0 && (
        <section className="rounded-lg bg-white p-4 shadow-sm" aria-labelledby="letzte-meldungen">
          <h2 id="letzte-meldungen" className="mb-1 text-sm font-semibold text-gray-700">
            Letzte Meldungen
          </h2>
          <ul className="divide-y text-sm">
            {data.recent.map((m) => (
              <li key={m.id} className="flex items-baseline gap-2 py-1.5">
                <span className="w-[4.6rem] shrink-0 text-xs tabular-nums text-gray-500">{fmtDate(isoDate(m.service_date))}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">
                    {m.lauf_nr ? `${m.lauf_nr} · ` : ''}
                    {animalLabel({ ear_tag: m.ear_tag ?? '', name: m.name })}
                  </span>
                  <span className="block truncate text-xs text-gray-600">
                    {[m.sire_name || (m.sire_ear_tag ? shortEarTag(m.sire_ear_tag) : null), m.kind === 'kb' ? 'KB' : m.kind === 'natursprung' ? 'Natursprung' : null, m.service_to ? `bis ${fmtDate(isoDate(m.service_to))}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
