import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { fmtKg, fmtChf, fmtDate, fmtAge, num, todayIso } from '../lib/format'
import { computeForecast } from '../lib/forecast'
import type { Animal, Weighing, Medication, SlaughterResult, AnimalGroup, AnimalSex, AnimalStatus } from '../types'

const SEX_LABEL: Record<AnimalSex, string> = { m: 'männlich', w: 'weiblich', k: 'kastriert' }
const STATUS_OPTIONS: AnimalStatus[] = ['aktiv', 'verkauft', 'geschlachtet', 'verendet']

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      {children}
    </label>
  )
}

interface Detail {
  animal: Animal
  weighings: Weighing[]
  medications: Medication[]
  slaughter: SlaughterResult | null
  group: AnimalGroup | null
}

function loadDetail(id: string) {
  return async (pg: PGlite): Promise<Detail | null> => {
    const { rows: animalRows } = await pg.query<Animal>(
      'select * from animals where id = $1 and deleted_at is null',
      [id],
    )
    if (animalRows.length === 0) return null

    const { rows: weighings } = await pg.query<Weighing>(
      'select * from weighings where animal_id = $1 and deleted_at is null order by date asc, updated_at asc',
      [id],
    )
    const { rows: medications } = await pg.query<Medication>(
      'select * from medications where animal_id = $1 and deleted_at is null order by date desc',
      [id],
    )
    const { rows: slaughterRows } = await pg.query<SlaughterResult>(
      'select * from slaughter_results where animal_id = $1 and deleted_at is null',
      [id],
    )
    const { rows: groupRows } = await pg.query<AnimalGroup>(
      `select g.* from animal_groups g
       join group_memberships gm on gm.group_id = g.id
       where gm.animal_id = $1 and gm.deleted_at is null and gm.end_date is null and g.deleted_at is null
       order by gm.start_date desc limit 1`,
      [id],
    )

    return {
      animal: animalRows[0],
      weighings,
      medications,
      slaughter: slaughterRows[0] ?? null,
      group: groupRows[0] ?? null,
    }
  }
}

export default function AnimalDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, loading, refresh } = useQuery(loadDetail(id!), [id])

  const [editingAnimal, setEditingAnimal] = useState(false)
  const [animalForm, setAnimalForm] = useState<Partial<Animal>>({})
  const [editingWeighingId, setEditingWeighingId] = useState<string | null>(null)
  const [weighingForm, setWeighingForm] = useState<Partial<Weighing>>({})
  const [editingMedicationId, setEditingMedicationId] = useState<string | null>(null)
  const [medicationForm, setMedicationForm] = useState<Partial<Medication>>({})
  const [editingSlaughter, setEditingSlaughter] = useState(false)
  const [slaughterForm, setSlaughterForm] = useState<Partial<SlaughterResult>>({})

  if (loading && !data) return <div className="p-4 text-center text-gray-400">Lädt…</div>
  if (!data) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Tier nicht gefunden.</p>
        <Link to="/tiere" className="mt-2 inline-block text-brand-700 underline">
          Zurück zur Liste
        </Link>
      </div>
    )
  }

  const { animal, weighings, medications, slaughter, group } = data
  const today = todayIso()

  async function saveAnimal() {
    await upsertRow('animals', { ...animal, ...animalForm })
    setEditingAnimal(false)
    refresh()
  }

  async function deleteAnimal() {
    if (!confirm(`${animal.ear_tag} wirklich löschen?`)) return
    await softDeleteRow('animals', animal.id)
    navigate('/tiere')
  }

  async function saveWeighing(w: Weighing) {
    await upsertRow('weighings', { ...w, ...weighingForm })
    setEditingWeighingId(null)
    refresh()
  }

  async function deleteWeighing(w: Weighing) {
    if (!confirm('Diese Wägung wirklich löschen?')) return
    await softDeleteRow('weighings', w.id)
    refresh()
  }

  async function saveMedication(m: Medication) {
    await upsertRow('medications', { ...m, ...medicationForm })
    setEditingMedicationId(null)
    refresh()
  }

  async function deleteMedication(m: Medication) {
    if (!confirm('Diesen Medikamenteneintrag wirklich löschen?')) return
    await softDeleteRow('medications', m.id)
    refresh()
  }

  async function saveSlaughter() {
    if (!slaughter) return
    await upsertRow('slaughter_results', { ...slaughter, ...slaughterForm })
    setEditingSlaughter(false)
    refresh()
  }

  async function deleteSlaughter() {
    if (!slaughter) return
    if (!confirm('Schlachtresultat wirklich löschen?')) return
    await softDeleteRow('slaughter_results', slaughter.id)
    refresh()
  }

  const chartData = weighings.map((w) => ({ date: w.date, weight: num(w.weight_kg) }))
  const last = weighings.at(-1)
  const prev = weighings.length >= 2 ? weighings.at(-2) : undefined
  const withdrawalUntil = medications.length
    ? medications
        .map((m) => {
          const d = new Date(m.date)
          d.setDate(d.getDate() + m.withdrawal_days)
          return d.toISOString().slice(0, 10)
        })
        .sort()
        .at(-1)!
    : null

  const forecast = computeForecast({
    lastWeighDate: last?.date ?? null,
    lastWeight: last ? num(last.weight_kg) : null,
    prevWeighDate: prev?.date ?? null,
    prevWeight: prev ? num(prev.weight_kg) : null,
    targetMinKg: num(group?.target_weight_min_kg) ?? 45,
    targetMaxKg: num(group?.target_weight_max_kg) ?? 50,
    withdrawalUntil,
    today,
  })

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <Link to="/tiere" className="text-sm text-brand-700">
          ← Alle Tiere
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">{animal.ear_tag}</h1>
          {!editingAnimal && (
            <button
              type="button"
              className="text-sm text-brand-700"
              onClick={() => {
                setAnimalForm(animal)
                setEditingAnimal(true)
              }}
            >
              Bearbeiten
            </button>
          )}
        </div>
      </div>

      {forecast.withdrawalOpen && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          ⚠️ Absetzfrist offen bis <strong>{fmtDate(withdrawalUntil)}</strong> — nicht schlachtreif.
        </div>
      )}

      {editingAnimal ? (
        <section className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
          <Field label="Ohrmarke">
            <input
              type="text"
              value={animalForm.ear_tag ?? ''}
              onChange={(e) => setAnimalForm((f) => ({ ...f, ear_tag: e.target.value }))}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Geschlecht">
              <select
                value={animalForm.sex ?? animal.sex}
                onChange={(e) => setAnimalForm((f) => ({ ...f, sex: e.target.value as AnimalSex }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              >
                {(Object.keys(SEX_LABEL) as AnimalSex[]).map((s) => (
                  <option key={s} value={s}>
                    {SEX_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={animalForm.status ?? animal.status}
                onChange={(e) => setAnimalForm((f) => ({ ...f, status: e.target.value as AnimalStatus }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Geburtsdatum">
              <input
                type="date"
                value={animalForm.birth_date ?? ''}
                onChange={(e) => setAnimalForm((f) => ({ ...f, birth_date: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </Field>
            <Field label="Eingangsdatum">
              <input
                type="date"
                value={animalForm.entry_date ?? ''}
                onChange={(e) => setAnimalForm((f) => ({ ...f, entry_date: e.target.value }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Eingangsgewicht (kg)">
              <input
                type="number"
                step="0.1"
                value={animalForm.entry_weight_kg ?? ''}
                onChange={(e) =>
                  setAnimalForm((f) => ({ ...f, entry_weight_kg: e.target.value ? Number(e.target.value) : null }))
                }
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </Field>
            <Field label="Kaufpreis (CHF)">
              <input
                type="number"
                step="0.01"
                value={animalForm.purchase_cost ?? 0}
                onChange={(e) => setAnimalForm((f) => ({ ...f, purchase_cost: Number(e.target.value) }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TVD-Nr. Herkunft">
              <input
                type="text"
                value={animalForm.source_tvd_nr ?? ''}
                onChange={(e) => setAnimalForm((f) => ({ ...f, source_tvd_nr: e.target.value || null }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </Field>
            <Field label="Herkunft (Name)">
              <input
                type="text"
                value={animalForm.source_name ?? ''}
                onChange={(e) => setAnimalForm((f) => ({ ...f, source_name: e.target.value || null }))}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </Field>
          </div>
          <Field label="Notizen">
            <input
              type="text"
              value={animalForm.notes ?? ''}
              onChange={(e) => setAnimalForm((f) => ({ ...f, notes: e.target.value || null }))}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveAnimal}
              className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white"
            >
              Speichern
            </button>
            <button
              type="button"
              onClick={() => setEditingAnimal(false)}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
            >
              Abbrechen
            </button>
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-2 gap-3">
          <InfoTile label="Status" value={animal.status} />
          <InfoTile label="Geschlecht" value={SEX_LABEL[animal.sex]} />
          <InfoTile label="Alter" value={fmtAge(animal.birth_date)} />
          <InfoTile label="Geburtsdatum" value={fmtDate(animal.birth_date)} />
          <InfoTile label="Gruppe" value={group?.name ?? '–'} />
          <InfoTile label="Aktuelles Gewicht" value={last ? fmtKg(num(last.weight_kg)) : '–'} />
        </section>
      )}

      {!slaughter && (
        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-600">Prognose</h2>
          <p className="text-gray-800">{forecast.reason}</p>
          {forecast.forecastDate && (
            <p className="text-sm text-gray-500">
              Voraussichtliches Zielgewicht am {fmtDate(forecast.forecastDate)}
            </p>
          )}
          {forecast.adgKgPerDay != null && (
            <p className="text-sm text-gray-500">
              Tageszunahme: {Math.round(forecast.adgKgPerDay * 1000)} g/Tag
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Gewichtsverlauf</h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Wägungen erfasst.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => fmtDate(d)} />
                <YAxis tick={{ fontSize: 11 }} domain={['dataMin - 3', 'dataMax + 3']} />
                <Tooltip
                  labelFormatter={(d) => fmtDate(String(d))}
                  formatter={(v) => [`${v} kg`, 'Gewicht']}
                />
                {group && (
                  <ReferenceLine y={num(group.target_weight_min_kg) ?? 45} stroke="#16a34a" strokeDasharray="4 4" />
                )}
                <Line type="monotone" dataKey="weight" stroke="#15803d" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Wägungen</h2>
        {weighings.length === 0 ? (
          <p className="text-sm text-gray-400">Noch keine Wägungen erfasst.</p>
        ) : (
          <ul className="divide-y">
            {[...weighings].reverse().map((w) =>
              editingWeighingId === w.id ? (
                <li key={w.id} className="space-y-2 py-2 text-sm">
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={weighingForm.date ?? w.date}
                      onChange={(e) => setWeighingForm((f) => ({ ...f, date: e.target.value }))}
                      className="rounded border border-gray-300 px-2 py-1"
                    />
                    <input
                      type="number"
                      step="0.1"
                      value={weighingForm.weight_kg ?? w.weight_kg}
                      onChange={(e) => setWeighingForm((f) => ({ ...f, weight_kg: Number(e.target.value) }))}
                      className="w-24 rounded border border-gray-300 px-2 py-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveWeighing(w)}
                      className="rounded bg-brand-700 px-3 py-1 text-white"
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingWeighingId(null)}
                      className="rounded border border-gray-300 px-3 py-1 text-gray-700"
                    >
                      Abbrechen
                    </button>
                  </div>
                </li>
              ) : (
                <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-gray-800">{fmtKg(num(w.weight_kg))}</span>
                    <span className="ml-2 text-gray-500">{fmtDate(w.date)}</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      className="text-brand-700"
                      onClick={() => {
                        setWeighingForm(w)
                        setEditingWeighingId(w.id)
                      }}
                    >
                      Bearbeiten
                    </button>
                    <button type="button" className="text-red-600" onClick={() => deleteWeighing(w)}>
                      Löschen
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Medikamente</h2>
        {medications.length === 0 ? (
          <p className="text-sm text-gray-400">Keine Einträge.</p>
        ) : (
          <ul className="divide-y">
            {medications.map((m) => {
              const until = new Date(m.date)
              until.setDate(until.getDate() + m.withdrawal_days)
              const untilIso = until.toISOString().slice(0, 10)
              const open = untilIso >= today

              if (editingMedicationId === m.id) {
                return (
                  <li key={m.id} className="space-y-2 py-2 text-sm">
                    <input
                      type="text"
                      value={medicationForm.medication_name ?? m.medication_name}
                      onChange={(e) => setMedicationForm((f) => ({ ...f, medication_name: e.target.value }))}
                      className="w-full rounded border border-gray-300 px-2 py-1"
                      placeholder="Medikament"
                    />
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={medicationForm.date ?? m.date}
                        onChange={(e) => setMedicationForm((f) => ({ ...f, date: e.target.value }))}
                        className="rounded border border-gray-300 px-2 py-1"
                      />
                      <input
                        type="number"
                        value={medicationForm.withdrawal_days ?? m.withdrawal_days}
                        onChange={(e) =>
                          setMedicationForm((f) => ({ ...f, withdrawal_days: Number(e.target.value) }))
                        }
                        className="w-24 rounded border border-gray-300 px-2 py-1"
                        placeholder="Absetzfrist (Tage)"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveMedication(m)}
                        className="rounded bg-brand-700 px-3 py-1 text-white"
                      >
                        Speichern
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingMedicationId(null)}
                        className="rounded border border-gray-300 px-3 py-1 text-gray-700"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </li>
                )
              }

              return (
                <li key={m.id} className="py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-gray-800">{m.medication_name}</span>
                    <span className="text-gray-500">{fmtDate(m.date)}</span>
                  </div>
                  <div className="text-gray-500">
                    {m.reason ?? ''} {m.dose ? `· ${m.dose}` : ''}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={open ? 'text-red-600' : 'text-gray-400'}>
                      Absetzfrist bis {fmtDate(untilIso)} {open ? '(offen)' : '(abgelaufen)'}
                    </span>
                    <span className="flex gap-3 text-xs">
                      <button
                        type="button"
                        className="text-brand-700"
                        onClick={() => {
                          setMedicationForm(m)
                          setEditingMedicationId(m.id)
                        }}
                      >
                        Bearbeiten
                      </button>
                      <button type="button" className="text-red-600" onClick={() => deleteMedication(m)}>
                        Löschen
                      </button>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Schlachtresultat</h2>
          {slaughter && !editingSlaughter && (
            <span className="flex gap-3 text-xs">
              <button
                type="button"
                className="text-brand-700"
                onClick={() => {
                  setSlaughterForm(slaughter)
                  setEditingSlaughter(true)
                }}
              >
                Bearbeiten
              </button>
              <button type="button" className="text-red-600" onClick={deleteSlaughter}>
                Löschen
              </button>
            </span>
          )}
        </div>
        {!slaughter ? (
          <p className="text-sm text-gray-400">Noch nicht geschlachtet.</p>
        ) : editingSlaughter ? (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Schlachtdatum">
                <input
                  type="date"
                  value={slaughterForm.slaughter_date ?? slaughter.slaughter_date}
                  onChange={(e) => setSlaughterForm((f) => ({ ...f, slaughter_date: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-2 py-1"
                />
              </Field>
              <Field label="Schlachtgewicht (kg)">
                <input
                  type="number"
                  step="0.1"
                  value={slaughterForm.carcass_weight_kg ?? slaughter.carcass_weight_kg ?? ''}
                  onChange={(e) =>
                    setSlaughterForm((f) => ({
                      ...f,
                      carcass_weight_kg: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1"
                />
              </Field>
              <Field label="Preis/kg (CHF)">
                <input
                  type="number"
                  step="0.01"
                  value={slaughterForm.price_per_kg ?? slaughter.price_per_kg ?? ''}
                  onChange={(e) =>
                    setSlaughterForm((f) => ({ ...f, price_per_kg: e.target.value ? Number(e.target.value) : null }))
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1"
                />
              </Field>
              <Field label="Erlös (CHF)">
                <input
                  type="number"
                  step="0.01"
                  value={slaughterForm.total_revenue ?? slaughter.total_revenue ?? ''}
                  onChange={(e) =>
                    setSlaughterForm((f) => ({ ...f, total_revenue: e.target.value ? Number(e.target.value) : null }))
                  }
                  className="w-full rounded border border-gray-300 px-2 py-1"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveSlaughter}
                className="rounded bg-brand-700 px-3 py-1 text-white"
              >
                Speichern
              </button>
              <button
                type="button"
                onClick={() => setEditingSlaughter(false)}
                className="rounded border border-gray-300 px-3 py-1 text-gray-700"
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Row label="Datum" value={fmtDate(slaughter.slaughter_date)} />
            <Row label="Schlachtbetrieb" value={slaughter.slaughterhouse ?? '–'} />
            <Row label="Schlachtgewicht" value={fmtKg(num(slaughter.carcass_weight_kg))} />
            <Row label="Klassifizierung" value={slaughter.classification ?? '–'} />
            <Row label="Fettklasse" value={slaughter.fat_class ?? '–'} />
            <Row label="Preis/kg" value={fmtChf(num(slaughter.price_per_kg))} />
            <Row label="Erlös" value={fmtChf(num(slaughter.total_revenue))} />
          </dl>
        )}
      </section>

      <section className="rounded-lg border border-red-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-red-700">Danger Zone</h2>
        <button
          type="button"
          onClick={deleteAnimal}
          className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
        >
          Tier löschen
        </button>
      </section>
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium text-gray-800">{value}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-800">{value}</dd>
    </>
  )
}
