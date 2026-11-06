import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import { useDb } from '@fmis/core/DbContext'
import { errorText } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { fmtCells } from '../lib/culling'
import { localTodayIso } from '../lib/format'
import { loadFollowUpLambs, loadFollowUpParents, savePreselection, saveLoss, type FollowUpLamb, type FollowUpParents, type TraitValue } from '../lib/birthFollowUp'
import { ABORT_MONTHS, DEFECTS, isAbort, LOSS_GROUPS, parseDefects, toggleDefect } from '../lib/lambLoss'
import { PRESELECTIONS, preselectionLabel, recommendLamb, type Preselection, type Recommendation } from '../lib/lambRecommendation'
import { speciesOf } from '../lib/species'
import { loadSettings } from '../pages/LambSelection'
import { InbreedingBadge } from '../pages/AnimalDetail'
import TrendBadge from './TrendBadge'

const num = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1 })
const CHOICE_STYLE: Record<string, string> = {
  zucht: 'bg-green-700 text-white',
  eher_ja: 'bg-green-200 text-green-950',
  spaeter: 'bg-gray-600 text-white',
  eher_nein: 'bg-amber-200 text-amber-950',
  mast: 'bg-amber-700 text-white',
}

function Traits({ values, empty }: { values: TraitValue[]; empty: string }) {
  if (values.length === 0) return <p className="text-sm text-gray-600">{empty}</p>
  return (
    <p className="text-sm text-gray-800">
      {values.slice(0, 5).map((t, i) => (
        <span key={t.label}>
          {i > 0 && <span className="text-gray-400"> · </span>}
          <span className="whitespace-nowrap">
            {t.label} <b>{num(t.value)}</b>
          </span>
        </span>
      ))}
    </p>
  )
}

/** Gleich nach der Geburt: Leistung und Zuchtwert beider Eltern, je Jungtier Empfehlung und Vorauswahl,
 * bei toten Jungtieren die Ursache. Auch später aus der Liste der letzten Geburten erreichbar. */
export default function BirthFollowUp({ birthId, moduleKey }: { birthId: string; moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const young = species === 'sheep' ? 'Lamm' : 'Kalb'
  const today = localTodayIso()
  const { data, error } = useQuery((pg) => loadFollowUpLambs(pg, birthId, today), [birthId])
  // Der Herdenvergleich dauert; einmal rechnen, damit die Knöpfe bei jedem Tipp sofort reagieren
  const [parents, setParents] = useState<FollowUpParents | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    setParents(undefined)
    loadFollowUpParents(db, species, birthId, today, loadSettings(moduleKey))
      .then((p) => current && setParents(p))
      .catch(() => current && setParents(null))
    return () => {
      current = false
    }
  }, [db, species, birthId, today, moduleKey])
  if (error) return <p className="text-sm text-red-600">{error}</p>
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm">
      {parents === undefined && <p className="text-gray-600">Lade Daten zu den Eltern …</p>}
      {parents === null && <p className="text-gray-600">Daten zu den Eltern nicht verfügbar.</p>}
      {parents && <Parents p={parents} />}
      {data?.lambs.length === 0 && <p className="text-gray-600">Keine Nachkommen erfasst.</p>}
      {data?.lambs.map((lamb, i) =>
        lamb.dead ? (
          <DeadLamb key={lamb.id} lamb={lamb} nr={i + 1} young={young} abortsRecent={data.abortsRecent} />
        ) : (
          <LiveLamb key={lamb.id} lamb={lamb} nr={i + 1} young={young} recommendation={parents ? recommendLamb({ sex: lamb.sex, ...parents.basis }) : null} />
        ),
      )}
    </div>
  )
}

function Parents({ p: { dam, sire, inbreeding } }: { p: FollowUpParents }) {
  const p = dam.performance
  const scc = p?.scc_geo ?? null
  return (
    <>
      <section className="space-y-0.5">
        <h3 className="font-semibold text-gray-900">
          Mutter{' '}
          {dam.id ? (
            <Link to={`../tiere/${dam.id}`} relative="path" className="text-brand-700">
              {dam.lauf_nr ? `${dam.lauf_nr} · ` : ''}
              {animalLabel({ ear_tag: dam.ear_tag ?? '', name: dam.name })}
            </Link>
          ) : (
            'unbekannt'
          )}
        </h3>
        {p ? (
          <p className="text-gray-800">
            {p.lactation_group}. Laktation · Leistung <b>{p.performance_rel != null ? `${Math.round(p.performance_rel * 100)} %` : '–'}</b> der Herde · Zellzahl <b>{scc != null ? fmtCells(scc) : '–'}</b>
            {dam.index != null && (
              <>
                {' '}
                · Index <b>{num(dam.index)}</b>
              </>
            )}{' '}
            {dam.trend && <TrendBadge trend={dam.trend} compact />}
          </p>
        ) : (
          <p className="text-gray-600">Noch keine Leistungsdaten.</p>
        )}
        <Traits values={dam.values} empty="Keine Zuchtwerte." />
      </section>

      <section className="space-y-0.5">
        <h3 className="font-semibold text-gray-900">
          Vater{' '}
          {sire.ear_tag ? (
            sire.id ? (
              <Link to={`../tiere/${sire.id}`} relative="path" className="text-brand-700">
                {sire.name || shortEarTag(sire.ear_tag)}
              </Link>
            ) : (
              sire.name || shortEarTag(sire.ear_tag)
            )
          ) : (
            'unbekannt'
          )}
        </h3>
        <Traits values={sire.values} empty="Keine Zuchtwerte." />
        {sire.fromParents && <p className="text-xs text-gray-600">Gesamtzuchtwert als Mittel seiner Eltern.</p>}
      </section>

      <p className="flex items-center gap-2 text-gray-700">
        Inzucht der Nachkommen <InbreedingBadge f={inbreeding} />
      </p>
    </>
  )
}

const sexSign = (s: 'w' | 'm' | null) => (s === 'w' ? '♀ ' : s === 'm' ? '♂ ' : '')

function LiveLamb({ lamb, nr, young, recommendation: rec }: { lamb: FollowUpLamb; nr: number; young: string; recommendation: Recommendation | null }) {
  const db = useDb()
  const today = localTodayIso()
  const [error, setError] = useState<string | null>(null)
  // sofort anzeigen, gespeichert wird im Hintergrund
  const [shown, setShown] = useState(lamb.preselection)
  useEffect(() => setShown(lamb.preselection), [lamb.preselection])
  const rowId = useRef(lamb.selection?.id ?? crypto.randomUUID())
  function choose(key: Preselection) {
    const next = shown === key ? null : key
    setShown(next)
    savePreselection(db, lamb, rowId.current, next, today).catch((e) => {
      setShown(lamb.preselection)
      setError(errorText(e, 'Speichern fehlgeschlagen'))
    })
  }
  return (
    <section className="space-y-1.5 border-t border-gray-200 pt-2">
      <h3 className="font-semibold text-gray-900">
        {sexSign(lamb.sex)}
        {young} {nr}
        <span className="ml-1 font-normal text-gray-600">{lamb.ear_tag ? shortEarTag(lamb.ear_tag) : 'Ohrmarke offen'}</span>
      </h3>
      {rec && (
        <p className="text-gray-800">
          Empfehlung: <b>{preselectionLabel(rec.choice)}</b>
          {rec.reasons.length > 0 && <span className="text-gray-600"> ({rec.reasons.join(', ')})</span>}
        </p>
      )}
      <div className="grid grid-cols-5 gap-1" role="group" aria-label={`Vorauswahl ${young} ${nr}`}>
        {PRESELECTIONS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={shown === c.key}
            onClick={() => choose(c.key)}
            className={`min-h-11 rounded-lg px-0.5 text-xs font-medium leading-tight sm:text-sm ${shown === c.key ? CHOICE_STYLE[c.key] : 'bg-gray-100 text-gray-800'} ${rec?.choice === c.key ? 'ring-2 ring-brand-700' : ''}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </section>
  )
}

function DeadLamb({ lamb, nr, young, abortsRecent }: { lamb: FollowUpLamb; nr: number; young: string; abortsRecent: number }) {
  const db = useDb()
  const [note, setNote] = useState(lamb.loss_note ?? '')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setNote(lamb.loss_note ?? ''), [lamb.loss_note])
  // sofort anzeigen, gespeichert wird im Hintergrund
  const [cause, setCause] = useState(lamb.loss_cause)
  useEffect(() => setCause(lamb.loss_cause), [lamb.loss_cause])
  const savedDefects = lamb.defects.join(',')
  const [defects, setDefects] = useState(lamb.defects)
  useEffect(() => setDefects(parseDefects(savedDefects)), [savedDefects])
  // nacheinander: saveLoss liest die Zeile und schreibt sie ganz, parallel ginge eine Änderung verloren
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const save = (patch: Parameters<typeof saveLoss>[2]) => {
    queue.current = queue.current.then(() => saveLoss(db, lamb.id, patch)).catch((e) => setError(errorText(e, 'Speichern fehlgeschlagen')))
  }
  return (
    <section className="space-y-1.5 border-t border-gray-200 pt-2">
      <h3 className="font-semibold text-gray-900">
        {sexSign(lamb.sex)}
        {young} {nr} <span className="font-normal text-gray-600">† Ursache</span>
      </h3>
      <select
        value={cause ?? ''}
        aria-label={`Ursache ${young} ${nr}`}
        onChange={(e) => {
          setCause(e.target.value || null)
          save({ loss_cause: e.target.value || null })
        }}
        className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-base"
      >
        <option value="">Bitte wählen</option>
        {LOSS_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {isAbort(cause) && (
        <p role="alert" className="rounded-lg bg-amber-50 p-2 text-amber-900">
          Jeden sichtbaren Abort der Tierärztin oder dem Tierarzt melden (TSV Art. 129).
          {abortsRecent > 1 && <b> {abortsRecent} Aborte in den letzten {ABORT_MONTHS} Monaten erfasst: Bei mehr als einem nimmt die Tierarztpraxis Proben.</b>}
        </p>
      )}
      {cause === 'gebrechen' && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Gebrechen">
          {DEFECTS.map((d) => {
            const on = defects.includes(d.key)
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = toggleDefect(defects, d.key)
                  setDefects(parseDefects(next))
                  save({ defects: next || null })
                }}
                className={`min-h-11 rounded-lg px-2 text-sm ${on ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-800'}`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (lamb.loss_note ?? '') && save({ loss_note: note.trim() || null })}
        placeholder="Bemerkung"
        aria-label={`Bemerkung ${young} ${nr}`}
        className="min-h-11 w-full rounded-lg border border-gray-300 px-2 text-base"
      />
      {error && <p className="text-red-600">{error}</p>}
    </section>
  )
}
