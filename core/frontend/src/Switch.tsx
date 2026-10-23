/** Umschalter (Schieber) statt Knopf mit Text. Mindestens 44 px hoch tippbar. */
export default function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  /** für Screenreader */
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid min-h-11 min-w-14 shrink-0 place-items-center disabled:opacity-40"
    >
      <span className={`relative h-7 w-12 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
