/** Textfeld für useEarTagFilter — numerische Mobile-Tastatur, da meist nach
 * Ziffern der Ohrmarke gefiltert wird. */
export default function EarTagFilterInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Ohrmarke filtern…"
      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
    />
  )
}
