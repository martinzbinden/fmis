// Erfasste Geburt bearbeiten: Datum, Vater, Verlauf, Bemerkung, Nachkommen ändern, ergänzen oder entfernen
// (lib/editBirth.ts). Aus der Liste der letzten Geburten (pages/BirthEntry.tsx) und auf der Tierseite.

import { useEffect, useState } from 'react'
import { shortEarTag } from '@fmis/core/earTag'
import { useDb } from '@fmis/core/DbContext'
import NumberInput from '@fmis/core/NumberInput'
import { errorText, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { inTransaction } from '../db/transaction'
import { useQuery } from '../hooks/useQuery'
import { loadBirthForEdit, saveBirthEdit, validateBirthEdit, type EditBirth, type EditOffspring } from '../lib/editBirth'
import { isoDate, localTodayIso } from '../lib/format'
import type { OffspringFate } from '../lib/recordBirth'
import { loadSireOptions } from '../lib/sires'
import { speciesOf } from '../lib/species'
import type { Animal } from '../types'
import SireSelect from './SireSelect'

const FATES: { key: OffspringFate; label: string }[] = [
  { key: 'lebend', label: 'lebend' },
  { key: 'totgeboren', label: 'tot geboren' },
  { key: 'verendet', label: 'verendet < 24 h' },
]
const MAX_OFFSPRING = 5
const NEW: EditOffspring = { id: null, ear_tag: '', sex: null, fate: 'lebend', birth_weight_kg: null, tag_later: false, animalId: null, tagged: false, diedOn: null }

export default function BirthEdit({ birthId, moduleKey, onClose }: { birthId: string; moduleKey: string; onClose: () => void }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const word = species === 'sheep' ? { event: 'Ablammung', young: 'Lamm', youngPl: 'Lämmer' } : { event: 'Abkalbung', young: 'Kalb', youngPl: 'Kälber' }
  const { data, error: loadError } = useQuery(
    async (pg) => {
      const animals = (await pg.query<Animal>('select * from animals where deleted_at is null')).rows
      const [birth, sires, others] = await Promise.all([
        loadBirthForEdit(pg, birthId, animals),
        loadSireOptions(pg),
        pg.query<{ birth_date: unknown }>('select b.birth_date from births b join births x on x.dam_id = b.dam_id where x.id = $1 and b.id <> $1 and b.deleted_at is null', [birthId]),
      ])
      return { animals, birth, sires, otherDates: others.rows.map((r) => isoDate(r.birth_date)!) }
    },
    [birthId],
  )
  const [edit, setEdit] = useState<EditBirth | null>(null)
  const [before, setBefore] = useState<EditBirth | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // einmal übernehmen; spätere Neuladungen (z.B. Abgleich) überschreiben die Eingaben nicht
  useEffect(() => {
    if (data?.birth && !before) {
      setBefore(data.birth)
      setEdit(data.birth)
    }
  }, [data, before])

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
  if (data && !data.birth) return <p className="text-sm text-gray-600">Geburt nicht gefunden.</p>
  if (!edit || !before || !data) return <p className="text-sm text-gray-500">Lädt…</p>

  const patch = (p: Partial<EditBirth>) => setEdit({ ...edit, ...p })
  const patchO = (i: number, p: Partial<EditOffspring>) => setEdit({ ...edit, offspring: edit.offspring.map((o, j) => (j === i ? { ...o, ...p } : o)) })
  const kept = edit.offspring.filter((o) => !o.remove).length

  async function save() {
    if (!edit || !before || !data) return
    const problem = validateBirthEdit(edit, before, data.animals, data.otherDates, localTodayIso())
    if (problem) return setError(problem)
    setSaving(true)
    setError(null)
    try {
      const res = await undoAction(`${word.event} ${shortEarTag(edit.dam.ear_tag)} bearbeitet`, () => inTransaction(db, (tx) => saveBirthEdit(tx, edit, before, data.animals)))
      notifySuccess(`${word.event} gespeichert${res.created ? ` — ${res.created} ${res.created === 1 ? word.young : word.youngPl} im Bestand angelegt` : ''}`)
      onClose()
    } catch (e) {
      setError(errorText(e, 'Speichern fehlgeschlagen'))
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base'
  return (
    <section className="space-y-3 rounded-lg border-2 border-brand-700 bg-white p-3 text-sm" aria-label={`${word.event} bearbeiten`}>
      {edit.manual ? (
        <>
          <label className="block text-gray-600">
            Datum
            <input type="date" value={edit.birth_date} max={localTodayIso()} onChange={(e) => e.target.value && patch({ birth_date: e.target.value })} className={input} />
          </label>
          <SireSelect label="Vater" options={data.sires} value={edit.sire} onChange={(sire) => patch({ sire })} />
        </>
      ) : (
        <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-700">Aus dem Herdebuch-Import: Datum und Vater dort ändern, sonst verdoppelt der nächste Import die Geburt.</p>
      )}
      {species === 'cattle' && (
        <label className="block text-gray-600">
          Geburtsverlauf
          <select value={edit.ease ?? ''} onChange={(e) => patch({ ease: e.target.value ? Number(e.target.value) : null })} className={input}>
            <option value="">–</option>
            <option value="1">normal / ohne Hilfe</option>
            <option value="2">leichte Hilfe</option>
            <option value="3">schwer</option>
            <option value="4">Kaiserschnitt</option>
          </select>
        </label>
      )}

      {edit.offspring.map((o, i) =>
        o.remove ? (
          <div key={o.id ?? `n${i}`} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 px-3 text-gray-500">
            <span className="line-through">
              {word.young} {i + 1}
              {o.ear_tag ? ` · ${shortEarTag(o.ear_tag)}` : ''}
            </span>
            <button type="button" onClick={() => patchO(i, { remove: false })} className="min-h-11 font-medium text-brand-700">
              behalten
            </button>
          </div>
        ) : (
          <div key={o.id ?? `n${i}`} className="space-y-2 rounded-lg border border-gray-200 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-500">
                {word.young} {i + 1}
                {o.id == null && <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-green-900">neu</span>}
                {o.tagged && <span className="ml-1 font-medium text-gray-800">{shortEarTag(o.ear_tag)}</span>}
              </span>
              {!o.animalId && kept > 1 && (
                <button
                  type="button"
                  onClick={() => (o.id == null ? setEdit({ ...edit, offspring: edit.offspring.filter((_, j) => j !== i) }) : patchO(i, { remove: true }))}
                  aria-label={`${word.young} ${i + 1} entfernen`}
                  className="min-h-9 rounded-lg px-2 text-red-700"
                >
                  ✕ entfernen
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {(['w', 'm'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={o.sex === s}
                  onClick={() => patchO(i, { sex: s })}
                  className={`min-h-11 flex-1 rounded-lg ${o.sex === s ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}
                >
                  {s === 'w' ? '♀ weiblich' : '♂ männlich'}
                </button>
              ))}
            </div>
            {o.animalId ? (
              <p className="text-xs text-gray-600">Im Bestand{o.fate === 'lebend' ? '' : ` (${FATES.find((f) => f.key === o.fate)?.label})`}: Verbleib über die Tierseite (Abgang).</p>
            ) : (
              <div className="flex gap-1.5">
                {FATES.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={o.fate === f.key}
                    onClick={() => patchO(i, { fate: f.key })}
                    className={`min-h-11 flex-1 rounded-lg px-1 ${o.fate === f.key ? (f.key === 'lebend' ? 'bg-green-700 text-white' : 'bg-gray-700 text-white') : 'bg-gray-100 text-gray-700'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            {o.diedOn && <p className="text-xs text-gray-600">verendet am {o.diedOn.split('-').reverse().join('.')}</p>}
            {o.id == null && o.fate === 'lebend' && (
              <button
                type="button"
                aria-pressed={!!o.tag_later}
                onClick={() => patchO(i, { tag_later: !o.tag_later, ear_tag: '' })}
                className={`min-h-11 w-full rounded-lg ${o.tag_later ? 'bg-amber-700 font-semibold text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                🏷️ Ohrmarke später nachtragen
              </button>
            )}
            <div className="grid grid-cols-3 gap-2">
              {o.tagged || o.tag_later ? (
                <p className={`col-span-2 content-center rounded-lg px-3 ${o.tagged ? 'bg-gray-50 text-gray-700' : 'bg-amber-50 text-amber-900'}`}>
                  {o.tagged ? `Ohrmarke ${shortEarTag(o.ear_tag)}` : 'Ohrmarke offen (Pendenz)'}
                </p>
              ) : (
                <input
                  value={o.ear_tag}
                  onChange={(e) => patchO(i, { ear_tag: e.target.value })}
                  placeholder={o.fate === 'lebend' ? (o.id ? 'Ohrmarke (sonst offen)' : 'Ohrmarke') : 'Ohrmarke (falls markiert)'}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`Ohrmarke ${word.young} ${i + 1}`}
                  className={`col-span-2 ${input}`}
                />
              )}
              <NumberInput
                value={o.birth_weight_kg ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value)
                  patchO(i, { birth_weight_kg: v != null && Number.isFinite(v) ? v : null })
                }}
                placeholder="kg"
                aria-label={`Geburtsgewicht kg ${word.young} ${i + 1}`}
                className={input}
              />
            </div>
          </div>
        ),
      )}
      {edit.offspring.length < MAX_OFFSPRING && (
        <button type="button" onClick={() => setEdit({ ...edit, offspring: [...edit.offspring, { ...NEW }] })} className="min-h-11 w-full rounded-lg border-2 border-dashed border-brand-700 font-semibold text-brand-800">
          ＋ weiteres {word.young}
        </button>
      )}
      <label className="block text-gray-600">
        Bemerkung
        <input value={edit.notes} onChange={(e) => patch({ notes: e.target.value })} className={input} />
      </label>
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg border-2 border-gray-300 px-4">
          Abbrechen
        </button>
        <button type="button" disabled={saving} onClick={() => void save()} className="min-h-11 flex-1 rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-50">
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </section>
  )
}
