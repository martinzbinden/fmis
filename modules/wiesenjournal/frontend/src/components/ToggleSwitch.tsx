/** Kleiner iOS-artiger Umschalter — ersetzt einzelne Checkboxen wie
 * "Ackerkulturen anzeigen", wo ein Schalter statt eines Kästchens klarer
 * zeigt, dass eine Ansicht umgeschaltet statt ein Feld angehakt wird. */
export default function ToggleSwitch({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  title?: string
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-gray-600" title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-gray-300'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      {label}
    </label>
  )
}
