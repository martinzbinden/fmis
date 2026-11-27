import { PRESELECTIONS, type Preselection } from '../lib/lambRecommendation'

const CHOICE_STYLE: Record<Preselection, string> = {
  zucht: 'bg-green-700 text-white',
  eher_ja: 'bg-green-200 text-green-950',
  spaeter: 'bg-gray-600 text-white',
  eher_nein: 'bg-amber-200 text-amber-950',
  mast: 'bg-amber-700 text-white',
}

/** Skala der Zuchtauswahl: Zucht / eher ja / später / eher nein / Mast. Die Empfehlung hat einen Rahmen;
 * nochmals auf die gewählte Stufe tippen nimmt die Wahl zurück (onChoose(null)). */
export default function ChoiceScale({
  value,
  recommended,
  onChoose,
  label,
  disabled,
  compact,
}: {
  value: Preselection | null
  recommended?: Preselection | null
  onChoose: (next: Preselection | null) => void
  label: string
  disabled?: boolean
  /** schmaler für Tabellen */
  compact?: boolean
}) {
  return (
    <div className={`grid grid-cols-5 gap-1 ${compact ? 'min-w-[17rem]' : ''}`} role="group" aria-label={label}>
      {PRESELECTIONS.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={value === c.key}
          disabled={disabled}
          onClick={() => onChoose(value === c.key ? null : c.key)}
          title={recommended === c.key ? 'Empfehlung' : undefined}
          className={`${compact ? 'min-h-9 text-xs' : 'min-h-11 text-xs sm:text-sm'} rounded-lg px-0.5 font-medium leading-tight disabled:opacity-60 ${value === c.key ? CHOICE_STYLE[c.key] : 'bg-gray-100 text-gray-800'} ${recommended === c.key ? 'ring-2 ring-brand-700' : ''}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
