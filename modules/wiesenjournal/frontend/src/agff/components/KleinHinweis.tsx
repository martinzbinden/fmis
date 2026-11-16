// Dezente Zeile unter einer gefilterten Parzellenliste: «7 kleine Parzellen (< 10 a) ausgeblendet · zeigen».
import { grenzeText } from '../lib/klein'

export default function KleinHinweis({
  anzahl,
  grenze,
  zeigen,
  onUmschalten,
  className = '',
}: {
  anzahl: number
  grenze: number
  zeigen: boolean
  onUmschalten: () => void
  className?: string
}) {
  if (anzahl === 0) return null
  const was = anzahl === 1 ? '1 kleine Parzelle' : `${anzahl} kleine Parzellen`
  return (
    <p className={`text-xs text-gray-500 ${className}`} data-testid="klein-hinweis">
      {was} (&lt; {grenzeText(grenze)}) {zeigen ? 'eingeblendet' : 'ausgeblendet'} ·{' '}
      <button type="button" className="inline-flex min-h-10 items-center px-1 text-brand-800 underline sm:min-h-6" onClick={onUmschalten}>
        {zeigen ? 'wieder ausblenden' : 'zeigen'}
      </button>
    </p>
  )
}
