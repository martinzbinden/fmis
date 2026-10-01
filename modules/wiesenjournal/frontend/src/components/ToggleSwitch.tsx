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
          // left-0.5 + right-auto explizit setzen statt dem Browser zu
          // überlassen: manche Engines legen auf role="switch" von sich aus
          // einen eigenen left/right-Versatz aufs erste Kind, der sich mit
          // dem eigenen translate-x addiert und das Thumb aus dem Schalter
          // herausschiebt (am 2026-10-01 so gefunden — Browser-UA-Quirk,
          // kein Tailwind-Problem, siehe keine passende Regel in den eigenen
          // Stylesheets).
          className={`absolute left-0.5 right-auto top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0'
          }`}
        />
      </button>
      {label}
    </label>
  )
}
