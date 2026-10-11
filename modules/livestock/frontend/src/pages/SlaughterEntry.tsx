import { useEffect, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { useEarTagFilter } from '../hooks/useEarTagFilter'
import EarTagFilterInput from '../components/EarTagFilterInput'
import { useDb } from '@fmis/core/DbContext'
import { upsertRow } from '../db/write'
import { todayIso } from '../lib/format'
import { directValue, marketValue, parseGrade } from '../lib/marketing'
import { loadMarketing } from '../lib/marketingData'
import type { Animal } from '../types'
import { shortEarTag } from '@fmis/core/earTag'

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
  const { filter, setFilter, filtered: visibleAnimals } = useEarTagFilter(animals, (a) => a.ear_tag)
  const [animalId, setAnimalId] = useState('')
  // Ausgewähltes Tier bleibt in der Liste sichtbar, auch wenn der Filter
  // danach geändert wird — sonst würde die Auswahl im <select> "verschwinden".
  const selectedAnimal = animals?.find((a) => a.id === animalId)
  const selectOptions =
    selectedAnimal && !(visibleAnimals ?? []).some((a) => a.id === animalId)
      ? [selectedAnimal, ...(visibleAnimals ?? [])]
      : (visibleAnimals ?? [])
  const [date, setDate] = useState(todayIso())
  const [slaughterhouse, setSlaughterhouse] = useState('')
  const [carcassWeight, setCarcassWeight] = useState('')
  const [classification, setClassification] = useState('')
  const [fatClass, setFatClass] = useState('')
  const [pricePerKg, setPricePerKg] = useState('')
  const [totalRevenue, setTotalRevenue] = useState('')
  const [channel, setChannel] = useState<'markt' | 'direkt'>('markt')
  const [butcherCost, setButcherCost] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Vorschläge aus lib/marketing.ts, solange der Betrieb nicht selbst
  // überschreibt: am Markt Preis/kg nach Klasse und Gewichtsabzug, Erlös
  // nach den Gebühren je Tier; direkt der Verkaufswert des Fleischs und die
  // Metzgerrechnung nach Tarif.
  const { data: marketing } = useQuery((pg) => loadMarketing(pg, date), [date])
  const [priceTouched, setPriceTouched] = useState(false)
  const [revenueTouched, setRevenueTouched] = useState(false)
  const [costTouched, setCostTouched] = useState(false)
  const w = Number(carcassWeight)
  const suggestion =
    marketing && w > 0
      ? channel === 'markt'
        ? marketValue(w, parseGrade(classification, fatClass), marketing.prices)
        : null
      : null
  const directSuggestion = marketing && w > 0 && channel === 'direkt' ? directValue(w, marketing.direct) : null
  useEffect(() => {
    if (channel === 'markt') {
      if (!priceTouched && suggestion) setPricePerKg(suggestion.pricePerKg.toFixed(2))
      if (!costTouched) setButcherCost('')
    } else {
      if (!priceTouched) setPricePerKg('')
      if (!costTouched && directSuggestion) setButcherCost(directSuggestion.butcherCost.toFixed(2))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, suggestion?.pricePerKg, directSuggestion?.butcherCost, priceTouched, costTouched])
  useEffect(() => {
    if (revenueTouched) return
    const p = Number(pricePerKg)
    if (channel === 'markt' && w > 0 && p > 0) {
      setTotalRevenue((w * p - (marketing?.prices.fee_per_animal ?? 0)).toFixed(2))
    } else if (channel === 'direkt' && directSuggestion) {
      setTotalRevenue(directSuggestion.meatValue.toFixed(2))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, pricePerKg, channel, directSuggestion?.meatValue, revenueTouched, marketing?.prices.fee_per_animal])

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
        channel,
        butcher_cost: channel === 'direkt' && butcherCost ? Number(butcherCost) : null,
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
      setButcherCost('')
      setNotes('')
      setRevenueTouched(false)
      setPriceTouched(false)
      setCostTouched(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Schlachtung erfassen</h1>
      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <Field label="Ohrmarke">
          <div className="mb-2">
            <EarTagFilterInput value={filter} onChange={setFilter} />
          </div>
          <select
            value={animalId}
            onChange={(e) => setAnimalId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          >
            <option value="">Bitte wählen…</option>
            {selectOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {shortEarTag(a.ear_tag)}
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
        <Field label="Vermarktung">
          <div className="grid grid-cols-2 gap-2">
            {(['markt', 'direkt'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`rounded border px-3 py-3 text-base ${
                  channel === c ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800' : 'border-gray-300'
                }`}
              >
                {c === 'markt' ? 'Markt / Händler' : 'Direktvermarktung'}
              </button>
            ))}
          </div>
        </Field>
        <Field label={channel === 'markt' ? 'Schlachtbetrieb / Händler' : 'Metzger'}>
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
            onChange={(e) => {
              setPriceTouched(true)
              setPricePerKg(e.target.value)
            }}
            className="w-full rounded border border-gray-300 px-3 py-3 text-base"
          />
        </Field>
        {suggestion && (
          <p className="-mt-2 text-xs text-gray-500">
            Proviande {suggestion.category}: {suggestion.basePerKg.toFixed(2)}
            {suggestion.gradeDelta ? ` ${suggestion.gradeDelta > 0 ? '+' : '−'} ${Math.abs(suggestion.gradeDelta).toFixed(2)} Klasse` : ''}
            {suggestion.weightDeduction ? ` − ${suggestion.weightDeduction.toFixed(2)} Gewicht` : ''} ={' '}
            {suggestion.pricePerKg.toFixed(2)} Fr./kg; Erlös nach {marketing?.prices.fee_per_animal.toFixed(2)} Gebühren.
          </p>
        )}
        {channel === 'direkt' && (
          <Field label="Metzgerrechnung (CHF, inkl. MwSt)">
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={butcherCost}
              onChange={(e) => {
                setCostTouched(true)
                setButcherCost(e.target.value)
              }}
              className="w-full rounded border border-gray-300 px-3 py-3 text-base"
            />
          </Field>
        )}
        {directSuggestion && (
          <p className="-mt-2 text-xs text-gray-500">
            Nach Tarif: {directSuggestion.meatKg.toFixed(1)} kg Fleisch, {directSuggestion.packs} Pakete; Verkaufswert
            zum Mischpreis {marketing?.direct.meat_price_per_kg.toFixed(2)}/kg, bleibt{' '}
            {directSuggestion.net.toFixed(2)} nach dem Metzger.
          </p>
        )}
        <Field label={channel === 'markt' ? 'Erlös (CHF)' : 'Verkaufswert Fleisch (CHF)'}>
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
