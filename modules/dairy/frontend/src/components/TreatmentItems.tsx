import { fmtDate } from '../lib/format'
import { releaseDate } from '../lib/treatments'
import type { TemplateItem } from '../types'

export interface MedicationInfo {
  medication: string
  dose: string | null
  applications: number | null
  milk_days: number | null
  meat_days: number | null
}

export const emptyItem = (): TemplateItem => ({ medication: '', dose: '', applications: 1, days: 1, milk_days: null, meat_days: null })

const intOrNull = (s: string) => (s.trim() === '' ? null : Math.max(0, Number.parseInt(s, 10) || 0))
const lastDay = (date: string, days: number | null) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.max(1, days ?? 1) - 1)
  return d.toISOString().slice(0, 10)
}

/** Präparate eines Falls: Handelsname (Vorschläge aus dem Journal), Menge,
 * Anwendungen, Dauer, Absetzfristen laut Packungsbeilage; zeigt die
 * Freigabe. Bekanntes Präparat füllt leere Felder aus der letzten Anwendung. */
export default function TreatmentItems({
  items,
  onChange,
  known,
  date,
  factor,
  compact = false,
}: {
  items: TemplateItem[]
  onChange: (items: TemplateItem[]) => void
  known: MedicationInfo[]
  /** Behandlungsbeginn — ohne: keine Freigabe-Anzeige (Favoriten) */
  date?: string
  factor: number
  compact?: boolean
}) {
  const input = compact ? 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm' : 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base'
  const set = (i: number, patch: Partial<TemplateItem>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)))
  const pickMedication = (i: number, value: string) => {
    const k = known.find((m) => m.medication === value)
    const it = items[i]
    set(i, {
      medication: value,
      ...(k && {
        dose: it.dose || k.dose || '',
        applications: it.applications ?? k.applications,
        milk_days: it.milk_days ?? k.milk_days,
        meat_days: it.meat_days ?? k.meat_days,
      }),
      hint: value ? undefined : it.hint,
    })
  }

  return (
    <div className="space-y-2">
      <datalist id="dairy-medications">
        {known.map((m) => (
          <option key={m.medication} value={m.medication} />
        ))}
      </datalist>
      {items.map((it, i) => {
        const last = date ? lastDay(date, it.days) : null
        const milk = last ? releaseDate(last, it.milk_days, factor) : null
        const meat = last ? releaseDate(last, it.meat_days, factor) : null
        return (
          <div key={i} className={`space-y-2 rounded-lg border p-2 ${!it.medication && it.hint ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}>
            <div className="flex items-start gap-2">
              <label className="block flex-1 text-sm text-gray-600">
                Präparat (Handelsname)
                <input
                  list="dairy-medications"
                  value={it.medication}
                  onChange={(e) => pickMedication(i, e.target.value)}
                  placeholder={it.hint ?? 'z.B. Dolovet ad us. vet., Pulver'}
                  className={input}
                />
              </label>
              {items.length > 1 && (
                <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className="mt-6 px-1 text-lg text-gray-400" aria-label="Präparat entfernen">
                  ×
                </button>
              )}
            </div>
            {!it.medication && it.hint && <p className="text-xs text-amber-900">⚠ {it.hint}</p>}
            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-3 block text-sm text-gray-600 sm:col-span-1">
                Menge / Dosis
                <input value={it.dose} onChange={(e) => set(i, { dose: e.target.value })} placeholder="z.B. 1 Beutel, 10 ml i.m." className={input} />
              </label>
              <label className="block text-sm text-gray-600">
                Anwendungen
                <input inputMode="numeric" value={it.applications ?? ''} onChange={(e) => set(i, { applications: intOrNull(e.target.value) })} className={input} />
              </label>
              <label className="block text-sm text-gray-600">
                über Tage
                <input inputMode="numeric" value={it.days ?? ''} onChange={(e) => set(i, { days: intOrNull(e.target.value) })} className={input} />
              </label>
              <label className="block text-sm text-gray-600">
                Frist Milch (T.)
                <input inputMode="numeric" value={it.milk_days ?? ''} onChange={(e) => set(i, { milk_days: intOrNull(e.target.value) })} className={input} />
              </label>
              <label className="block text-sm text-gray-600">
                Frist Fleisch (T.)
                <input inputMode="numeric" value={it.meat_days ?? ''} onChange={(e) => set(i, { meat_days: intOrNull(e.target.value) })} className={input} />
              </label>
            </div>
            {date && it.medication && (
              <p className="text-xs text-gray-600">
                {(it.days ?? 1) > 1 && `letzte Anwendung ${fmtDate(last)} · `}
                {milk ? <b className="text-red-700">Milch frei ab {fmtDate(milk)}</b> : it.milk_days === 0 ? 'Milch: keine Frist' : 'Milch: Frist angeben'}
                {' · '}
                {meat ? <b className="text-red-700">Fleisch frei ab {fmtDate(meat)}</b> : it.meat_days === 0 ? 'Fleisch: keine Frist' : 'Fleisch: Frist angeben'}
              </p>
            )}
          </div>
        )
      })}
      <button type="button" onClick={() => onChange([...items, emptyItem()])} className="text-sm font-medium text-brand-700">
        ＋ weiteres Präparat
      </button>
    </div>
  )
}
