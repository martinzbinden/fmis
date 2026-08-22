import { useEffect, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useDb } from '../db/DbContext'
import { upsertRow } from '../db/write'
import { todayIso } from '../lib/format'
import type { Animal } from '../types'

interface AnimalOption {
  id: string
  ear_tag: string
}

async function loadAnimals(pg: PGlite): Promise<AnimalOption[]> {
  const { rows } = await pg.query<AnimalOption>(
    "select id, ear_tag from animals where deleted_at is null and status = 'aktiv' order by ear_tag",
  )
  return rows
}

export default function SlaughterEntry() {
  const db = useDb()
  const { data: animals } = useQuery(loadAnimals)
  const [animalId, setAnimalId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [slaughterhouse, setSlaughterhouse] = useState('')
  const [carcassWeight, setCarcassWeight] = useState('')
  const [classification, setClassification] = useState('')
  const [fatClass, setFatClass] = useState('')
  const [pricePerKg, setPricePerKg] = useState('')
  const [totalRevenue, setTotalRevenue] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Erlös automatisch aus Schlachtgewicht × Preis/kg vorschlagen, solange
  // der Betrieb ihn nicht manuell überschreibt.
  const [revenueTouched, setRevenueTouched] = useState(false)
  useEffect(() => {
    if (revenueTouched) return
    const w = Number(carcassWeight)
    const p = Number(pricePerKg)
    if (w > 0 && p > 0) setTotalRevenue((w * p).toFixed(2))
  }, [carcassWeight, pricePerKg, revenueTouched])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSavedMsg(null)
    if (!animalId) {
      setError('Bitte Ohrmarke wählen.')
      return
    }
    setSaving(true)
    try {
      await upsertRow('slaughter_results', {
        id: crypto.randomUUID(),
        animal_id: animalId,
        slaughter_date: date,
        slaughterhouse: slaughterhouse || null,
        carcass_weight_kg: carcassWeight ? Number(carcassWeight) : null,
        classification: classification || null,
        fat_class: fatClass || null,
        price_per_kg: pricePerKg ? Number(pricePerKg) : null,
        total_revenue: totalRevenue ? Number(totalRevenue) : null,
        notes: notes || null,
      })
      // upsertRow schreibt alle Spalten neu (fehlende -> null), daher die
      // volle Tierzeile laden, status patchen und komplett zurückschreiben.
      const { rows: animalRows } = await db.query<Animal>(
        'select * from animals where id = $1',
        [animalId],
      )
      if (animalRows.length > 0) {
        await upsertRow('animals', { ...animalRows[0], status: 'geschlachtet' })
      }
      setSavedMsg('Schlachtresultat gespeichert.')
      setAnimalId('')
      setSlaughterhouse('')
      setCarcassWeight('')
      setClassification('')
      setFatClass('')
      setPricePerKg('')
      setTotalRevenue('')
      setNotes('')
      setRevenueTouched(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Schlachtung erfassen</h1>
      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <Field label="Ohrmarke">
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
        <Field label="Schlachtdatum">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Schlachtbetrieb">
          <input
            type="text"
            value={slaughterhouse}
            onChange={(e) => setSlaughterhouse(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Schlachtgewicht (kg)">
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={carcassWeight}
            onChange={(e) => setCarcassWeight(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Klassifizierung">
            <input
              type="text"
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
              placeholder="z.B. T3"
              className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            />
          </Field>
          <Field label="Fettklasse">
            <input
              type="text"
              value={fatClass}
              onChange={(e) => setFatClass(e.target.value)}
              placeholder="z.B. 3"
              className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            />
          </Field>
        </div>
        <Field label="Preis/kg (CHF)">
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={pricePerKg}
            onChange={(e) => setPricePerKg(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Erlös (CHF)">
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={totalRevenue}
            onChange={(e) => {
              setRevenueTouched(true)
              setTotalRevenue(e.target.value)
            }}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        <Field label="Notizen (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
