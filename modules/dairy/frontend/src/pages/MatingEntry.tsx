import { useEffect, useMemo, useRef, useState } from 'react'
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
import { daysBetween, fmtDate, isoDate, localTodayIso } from '../lib/format'
import { CYCLE_DAYS, MARKER_COLORS, currentMarker, isMarkerColor, markerLabel, nextMarkerColor, type MarkerColor } from '../lib/markerColor'
import { loadMilkSamples, readMilkFeedSettings } from '../lib/milkFeed'
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
  marker_color: string | null
  ear_tag: string | null
  lauf_nr: string | null
  name: string | null
}

async function loadData(pg: PGlite) {
  const [animals, sires, lastBirths, matings, inbreeding, events, recent, testCalving, milk] = await Promise.all([
    pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w' order by lauf_nr nulls last, ear_tag"),
    loadSireOptions(pg, { presentOnly: true }),
    pg.query<{ dam_id: string; last_birth: unknown }>('select dam_id, max(birth_date) as last_birth from births where deleted_at is null group by dam_id'),
    pg.query<{ animal_id: string; service_date: unknown; service_to: unknown; sire_key: string | null; marker_color: string | null }>(
      'select animal_id, service_date, service_to, sire_key, marker_color from matings where deleted_at is null',
    ),
    loadInbreeding(pg),
    loadAnimalEvents(pg),
    pg.query<RecentRow>(
      `select m.id, m.service_date, m.service_to, m.kind, m.sire_name, m.sire_ear_tag, m.marker_color, a.ear_tag, a.lauf_nr, a.name
       from matings m left join animals a on a.id = m.animal_id
       where m.deleted_at is null order by m.service_date desc, m.updated_at desc limit ${RECENT_LIST}`,
    ),
    // Beginn der Laktation auch ohne erfasste Geburt: Abkalbedatum der Milchprüfungen
    pg.query<{ animal_id: string; calving: unknown }>('select animal_id, max(calving_date) as calving from milk_tests where deleted_at is null group by animal_id'),
    loadMilkSamples(pg),
  ])
  const lactationStart = new Map<string, string>()
  for (const [id, d] of [...lastBirths.rows.map((b) => [b.dam_id, isoDate(b.last_birth)] as const), ...testCalving.rows.map((t) => [t.animal_id, isoDate(t.calving)] as const)]) {
    if (d && (lactationStart.get(id) ?? '') < d) lactationStart.set(id, d)
  }
  return {
    events,
    females: animals.rows,
    sires,
    lastBirth: new Map(lastBirths.rows.map((b) => [b.dam_id, isoDate(b.last_birth)])),
    matings: matings.rows.map((m) => ({ animal_id: m.animal_id, service_date: isoDate(m.service_date)!, service_to: isoDate(m.service_to), sire_key: m.sire_key, marker_color: m.marker_color })),
    lactationStart,
    milk,
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
  // Farbe des Deckgurts; folgt beim Wechsel des Vatertiers dessen gültiger Farbe
  const [color, setColor] = useState<MarkerColor | null>(null)
  const milkSettings = useMemo(() => readMilkFeedSettings(moduleKey, species), [moduleKey, species])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  // nach «↶ Rückgängig» stimmt «Gespeichert» nicht mehr
  useOnUndo(() => {
    setSaved(null)
    setSkipped([])
  })

  // Vorbelegung: der zuletzt eingesetzte Widder/Stier im Bestand (einmal, sobald die Daten da sind)
  const sirePreset = useRef(false)
  useEffect(() => {
    if (!data || sirePreset.current) return
    sirePreset.current = true
    const last = data.sires.find((o) => o.lastUsed)
    if (last && !sire.key && !sire.ear_tag && !sire.name) setSire({ key: last.key, ear_tag: last.ear_tag, name: last.name ?? '' })
  }, [data, sire])
  const sireKeyNow = sire.key ?? animalKey(sire.ear_tag)
  const marker = useMemo(() => (data ? currentMarker(data.matings, sireKeyNow) : null), [data, sireKeyNow])
  // nur beim Wechsel des Vatertiers übernehmen (nicht nach jedem Speichern die eigene Wahl überschreiben)
  const markerFor = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!data || markerFor.current === sireKeyNow) return
    markerFor.current = sireKeyNow
    setColor(marker?.color ?? null)
  }, [data, sireKeyNow, marker])
  const today = localTodayIso()
  const markerDays = marker ? daysBetween(marker.since, today) : null
  const changeDue = marker != null && color === marker.color && markerDays != null && markerDays >= CYCLE_DAYS[species]

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
            marker_color: kind === 'natursprung' ? color : null,
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

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <SireSelect label={species === 'sheep' ? 'Widder' : 'Stier'} options={data?.sires ?? []} value={sire} onChange={setSire}>
          {kind === 'natursprung' && sireKeyNow && (
            <div className="rounded-lg bg-gray-50 p-2">
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-gray-800">
                <span>Gültige Farbe:</span>
                {color ? (
                  <span className="flex items-center gap-1.5 font-semibold">
                    <span aria-hidden className={`inline-block h-4 w-4 rounded-full ${MARKER_COLORS.find((c) => c.key === color)!.swatch}`} />
                    {markerLabel(color)}
                  </span>
                ) : (
                  <span className="text-gray-600">keine gewählt</span>
                )}
                {marker && color === marker.color && (
                  <span className="text-xs text-gray-600">
                    seit {fmtDate(marker.since)} ({markerDays} T.)
                  </span>
                )}
                {marker && color && color !== marker.color && <span className="text-xs font-medium text-amber-800">neu (bisher {markerLabel(marker.color)})</span>}
              </div>
              {changeDue && (
                <p className="mt-1 text-xs font-medium text-amber-800">
                  Über einen Zyklus ({CYCLE_DAYS[species]} T.): Farbwechsel fällig? Nächste wäre {markerLabel(nextMarkerColor(marker.color))}.
                </p>
              )}
              <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label="Farbe Deckgurt">
                {MARKER_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={color === c.key}
                    onClick={() => setColor(color === c.key ? null : c.key)}
                    className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border bg-white text-sm ${color === c.key ? `border-transparent font-semibold ring-2 ${c.ring}` : 'border-gray-300 text-gray-700'}`}
                  >
                    <span aria-hidden className={`inline-block h-3.5 w-3.5 rounded-full ${c.swatch}`} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </SireSelect>
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

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-1 text-sm text-gray-600">{terms.plural}</div>
        <AnimalPicker animals={females} selected={ids} onChange={setIds} multiple readerModule={moduleKey} hideSelected />
        {data && ids.length > 0 && (
          <>
            <div className="mt-3 flex items-baseline justify-between text-sm text-gray-600">
              <span>
                {ids.length} {ids.length === 1 ? terms.singular : terms.plural} gewählt
              </span>
              <span className="text-xs">LT = Laktationstag</span>
            </div>
            <ul className="mt-1 divide-y rounded-lg border border-gray-200">
              {[...ids].reverse().map((id) => {
                const a = byId.get(id)
                if (!a) return null
                const start = data.lactationStart.get(id)
                const lt = start ? daysBetween(start, today) : null
                // Wägung aus der vorherigen Laktation gilt nicht als aktuelle Milchleistung
                const raw = data.milk.get(id)
                const sample = raw && (!start || raw.date >= start) ? raw : undefined
                const sampleAge = sample ? daysBetween(sample.date, today) : null
                const dayKg = sample ? sample.kg * (sample.perMilking ? milkSettings.milkingsPerDay : 1) : null
                const duplicate = duplicateText(id)
                const warnings = duplicate ? [] : animalWarnings(id, eventsOf(data.events, id), { kind: 'mating', date: from }, species)
                const f = sireKeyNow ? data.inbreeding.offspring(animalKey(a.ear_tag), sireKeyNow) : null
                return (
                  <li key={id} className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="shrink-0 text-base font-bold text-gray-900">{a.lauf_nr ?? '–'}</span>
                          <span className="min-w-0 truncate text-sm text-gray-700">{animalLabel(a)}</span>
                        </span>
                        <span className="flex flex-wrap gap-x-3 text-sm tabular-nums text-gray-800">
                          <span title={start ? `Laktation seit ${fmtDate(start)}` : 'keine Geburt bekannt'}>LT {lt ?? '–'}</span>
                          <span
                            className={sampleAge != null && sampleAge > milkSettings.maxSampleAgeDays ? 'text-gray-500' : ''}
                            title={sample ? `${sample.perMilking ? `Milchwägung ${sample.kg.toLocaleString('de-CH')} kg je Melkung × ${milkSettings.milkingsPerDay}` : 'Milchprüfung (Tagesmilch)'} am ${fmtDate(sample.date)}` : 'keine Wägung'}
                          >
                            {dayKg != null ? `${dayKg.toLocaleString('de-CH', { maximumFractionDigits: 1 })} kg/Tag · ${`${sample!.date.slice(8, 10)}.${sample!.date.slice(5, 7)}.`}` : raw ? 'noch keine Wägung in dieser Laktation' : 'keine Milch gewogen'}
                          </span>
                          {f != null && f > 0 && <InbreedingBadge f={f} />}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIds(ids.filter((x) => x !== id))}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg text-gray-600 active:bg-gray-100"
                        aria-label={`${a.lauf_nr ?? animalLabel(a)} entfernen`}
                      >
                        ×
                      </button>
                    </div>
                    {duplicate && <p className="mt-1 rounded bg-amber-50 p-1.5 text-sm font-medium text-amber-900">⚠ {duplicate.slice(duplicate.indexOf(': ') + 2)}. Wird nicht nochmals gemeldet.</p>}
                    {warnings.length > 0 && <AnimalWarnings animalIds={[id]} warnings={warnings} />}
                  </li>
                )
              })}
            </ul>
            {sireKeyNow && ids.some((id) => data.inbreeding.offspring(animalKey(byId.get(id)?.ear_tag ?? ''), sireKeyNow) >= 0.0625) && (
              <p className="mt-2 text-sm font-medium text-red-700">⚠ Mindestens eine Anpaarung liegt bei 6.25 % Inzucht oder mehr.</p>
            )}
          </>
        )}
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
                    {isMarkerColor(m.marker_color) && <span aria-label={`Farbe ${markerLabel(m.marker_color)}`} className={`mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle ${MARKER_COLORS.find((c) => c.key === m.marker_color)!.swatch}`} />}
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
