import { useEffect, useState } from 'react'
import { settingsOnDate } from '@fmis/betrieb/lib/machineSettings'
import { recalc, sowingSummary, type SowingForm } from '../lib/sowing'

/** Saat/Übersaat: Mischung/Kultur, Sorte, Saatmenge ↔ Saatstärke (über TKG
 * und Keimfähigkeit), erwartete Pflanzen, Reihenabstand und weite Reihe.
 * Zeigt dazu die am selben Tag protokollierten Geräteeinstellungen
 * (Modul Betrieb). */
export default function SowingFields({
  label,
  onLabel,
  form,
  onForm,
  areaA,
  date,
  input,
}: {
  label: string
  onLabel: (v: string) => void
  form: SowingForm
  onForm: (f: SowingForm) => void
  areaA: number | null
  date: string
  input: string
}) {
  const hasDetails = [form.variety, form.tkg, form.seeds, form.rowSpacing].some((v) => v.trim() !== '')
  const [open, setOpen] = useState(hasDetails)
  useEffect(() => {
    if (hasDetails) setOpen(true)
  }, [hasDetails])
  const [machineLines, setMachineLines] = useState<Awaited<ReturnType<typeof settingsOnDate>>>([])
  useEffect(() => {
    let alive = true
    settingsOnDate(date)
      .then((l) => alive && setMachineLines(l))
      .catch(() => alive && setMachineLines([]))
    return () => {
      alive = false
    }
  }, [date])

  const set = (key: keyof SowingForm, value: string) => onForm(recalc({ ...form, [key]: value }, key))
  const sum = sowingSummary(form, areaA)
  const field = (key: keyof SowingForm, caption: string, placeholder = '', mode: 'decimal' | 'text' = 'decimal') => (
    <label className="block text-xs text-gray-600">
      {caption}
      <input
        type="text"
        inputMode={mode}
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        className={`${input} w-full`}
      />
    </label>
  )

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1">
        <input type="text" placeholder="Mischung / Kultur" value={label} onChange={(e) => onLabel(e.target.value)} className={`${input} flex-1`} />
        <input
          type="text"
          inputMode="decimal"
          placeholder="kg/ha"
          value={form.kgHa}
          onChange={(e) => set('kgHa', e.target.value)}
          className={`${input} w-20`}
        />
      </div>
      {sum.totalKg != null && <p className="text-xs text-gray-500">= {sum.totalKg.toLocaleString('de-CH')} kg für die Parzelle</p>}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand-700 underline">
          + Sorte, TKG, Saatstärke, Reihen
        </button>
      ) : (
        <div className="space-y-2 rounded-lg bg-gray-50 p-2">
          <div className="grid grid-cols-2 gap-2">
            {field('variety', 'Sorte', 'z.B. Wiwa', 'text')}
            {field('tkg', 'TKG (g)', 'z.B. 45')}
            {field('germination', 'Keimfähigkeit (%)', 'Etikett, sonst 100')}
            {field('seeds', 'Saatstärke (Kö/m²)', 'keimfähige')}
            {field('emergence', 'Feldaufgang (%)', 'z.B. 80')}
            <div className="text-xs text-gray-600">
              Pflanzen erwartet
              <div className="py-1.5 text-sm font-semibold text-gray-800">{sum.plants != null ? `${sum.plants} /m²` : '–'}</div>
            </div>
            {field('rowSpacing', 'Reihenabstand (cm)', 'z.B. 12.5')}
            {field('wideRowEvery', 'Weite Reihe: jede n-te zu', 'leer = keine')}
          </div>
          <p className="text-[11px] text-gray-500">
            Mit TKG rechnet kg/ha ↔ Körner/m² automatisch (kg/ha = Kö/m² × TKG ÷ Keimfähigkeit).
            {sum.perRowMeter != null && (
              <>
                {' '}
                <span className="font-semibold text-gray-700">
                  ≈ {sum.perRowMeter} Körner je Meter Reihe
                  {sum.sownRowsPct != null ? ` (${sum.sownRowsPct} % der Reihen gesät, Hasengassen)` : ''}
                </span>{' '}
                — zum Nachzählen hinter der Sämaschine.
              </>
            )}
          </p>
        </div>
      )}
      {machineLines.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          <div className="font-semibold">Geräteeinstellung an diesem Tag</div>
          {machineLines.map((l, i) => (
            <div key={i}>
              {l.machine}: {l.text || '–'}
              {l.crop ? ` · ${l.crop}` : ''}
              {l.measured_kg_ha != null ? ` · Abdrehprobe ${l.measured_kg_ha} kg/ha` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
