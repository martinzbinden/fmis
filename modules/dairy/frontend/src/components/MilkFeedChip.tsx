import NumberInput from '@fmis/core/NumberInput'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'
import type { Species } from '../lib/fertility'
import { fmtDate } from '../lib/format'
import { BIRTH_BASIS_LABEL, DEFAULT_MILK_FEED, MILK_FEED_FIELDS, saveMilkFeedSettings, type MilkFeed, type MilkFeedSettings } from '../lib/milkFeed'

const fr = (v: number) => Math.round(v).toLocaleString('de-CH')

/** Ausführliche Erklärung für den Tooltip. */
export function milkFeedTitle(m: MilkFeed, s: MilkFeedSettings): string {
  const lines = [
    `Nächste Geburt ${fmtDate(m.birth)} (${BIRTH_BASIS_LABEL[m.birthBasis]}), ${m.feedDays} Tage`,
    m.dailyKg == null
      ? 'Tagesmilch unbekannt: keine Wägung in dieser Laktation in den letzten Tagen'
      : m.milkDays > 0
        ? `Tagesmilch heute ≈ ${m.dailyKg.toFixed(2)} kg, ${s.declinePerMonth} % Rückgang je Monat, gemolken bis ${fmtDate(m.milkUntil!)} (${m.milkDays} Tage): ${m.milkKg.toFixed(0)} kg × ${s.milkPrice.toFixed(2)} Fr. = ${fr(m.milkValue)} Fr.`
        : 'melkt nicht mehr bis zur Geburt',
    ...(m.lambKg > 0 ? [`Saugende Lämmer trinken ≈ ${m.lambKg.toFixed(1)} kg/Tag bis zum Absetzen (korrigiert ≈ ${(m.correctedKg ?? 0).toFixed(1)} kg/Tag); danach geht dieser Teil in den Tank`] : []),
    `Futter: ${m.feedDays} Tage × ${s.feedPerDay.toFixed(2)} Fr. + ${m.milkKg.toFixed(0)} kg Milch × ${s.feedPerKgMilk.toFixed(2)} Fr. = ${fr(m.feedCost)} Fr.`,
  ]
  if (m.balance != null) lines.push(`Bilanz bis zur Geburt: ${m.balance >= 0 ? '+' : '−'}${fr(Math.abs(m.balance))} Fr.`)
  return lines.join('\n')
}

/** Kleiner Chip «Milch − Futter bis Geburt: +35 Fr.»; grün = Milch deckt das Futter, rot = nicht. */
export function MilkFeedChip({ m, s, short = false, points }: { m: MilkFeed; s: MilkFeedSettings; short?: boolean; points?: number }) {
  const cls = m.balance == null ? 'bg-gray-100 text-gray-700' : m.balance >= 0 ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
  const value = m.balance == null ? '?' : `${m.balance >= 0 ? '+' : '−'}${fr(Math.abs(m.balance))} Fr.`
  return (
    <span className={`rounded px-1.5 py-0.5 ${cls}`} title={`${milkFeedTitle(m, s)}${points ? `\nVorschlag Schlachtung: ${points > 0 ? '+' : '−'}${Math.abs(points)} Punkte` : ''}`}>
      🥛−🌾 {short ? '' : 'bis Geburt '}
      <b>{value}</b>
      {!short && m.balance != null && (
        <span className="font-normal">
          {' '}
          ({fr(m.milkKg)} kg {fr(m.milkValue)} − {fr(m.feedCost)})
        </span>
      )}
      {points ? <span className="ml-1 rounded bg-white/70 px-1 font-semibold">{points > 0 ? '+' : '−'}{Math.abs(points)} P.</span> : null}
    </span>
  )
}

/** Einstellungen der Rechnung, gemeinsam für Ausmerzliste und Dashboard. */
export function MilkFeedSettingsPanel({ moduleKey, species, value, className = '' }: { moduleKey: string; species: Species; value: MilkFeedSettings; className?: string }) {
  return (
    <SettingsEditor
      value={value}
      onSave={(v) => saveMilkFeedSettings(moduleKey, v)}
      onReset={() => DEFAULT_MILK_FEED[species]}
      label="Milch gegen Futter"
      className={`rounded-lg bg-white p-3 shadow-sm ${className}`}
      title="Milch gegen Futter bis zur nächsten Geburt: letzte Wägung mit Rückgang fortgeschrieben bis zum Trockenstellen, Futter bis zur Geburt. Eine Näherung."
    >
      {({ value: v, set, editing }) => (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MILK_FEED_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-2 text-xs text-gray-600">
              {f.label}
              {editing ? (
                <NumberInput step={f.step} value={v[f.key]} onChange={(e) => set({ ...v, [f.key]: Number(e.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm" />
              ) : (
                <ReadValue>{v[f.key]}</ReadValue>
              )}
            </label>
          ))}
        </div>
      )}
    </SettingsEditor>
  )
}
