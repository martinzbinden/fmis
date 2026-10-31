import { readDigits, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'

/** Textfeld für useEarTagFilter — numerische Mobile-Tastatur, da meist nach
 * Ziffern der Ohrmarke gefiltert wird. Mit dem Lesegerät (falls aktiviert)
 * setzt jede Lesung den Filter auf die gelesene Ohrmarke. */
export default function EarTagFilterInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const reader = useTagReader({
    moduleKey: 'livestock',
    onRead: (read) => {
      onChange(readDigits(read))
      return `Filter: ${read.earTag}`
    },
  })
  return (
    <div className="space-y-1.5">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ohrmarke filtern…"
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
      <TagReaderButton reader={reader} hint="Lesung setzt den Filter" />
    </div>
  )
}
