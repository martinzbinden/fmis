/** Ein kleines Lamm (Wolle, dunkles Gesicht, vier Beine) für die Anzahl saugender Lämmer/Kälber auf der Karte. */
function LambIcon({ className = '', weaned = false }: { className?: string; weaned?: boolean }) {
  return (
    <svg viewBox="0 0 26 20" width="30" height="23" aria-hidden className={className}>
      <g className={weaned ? 'fill-none stroke-sky-700' : 'fill-white stroke-gray-500'} strokeWidth="1.2">
        <circle cx="8" cy="8" r="4.4" />
        <circle cx="12.5" cy="6.6" r="4.4" />
        <circle cx="12" cy="10.5" r="4.2" />
        <circle cx="7.6" cy="11.2" r="3.6" />
      </g>
      <g className={weaned ? 'stroke-sky-700' : 'stroke-gray-700'} strokeWidth="1.6" strokeLinecap="round">
        <path d="M7 14.5v3.7M11 15v3.2M14 15v3.2M17 14v4.2" />
      </g>
      <ellipse cx="20" cy="8.6" rx="3.6" ry="3" className={weaned ? 'fill-sky-700' : 'fill-gray-700'} />
      <path d="M18.6 6.2 16.6 4.4M21.6 6 23.4 4.2" className={weaned ? 'stroke-sky-700' : 'stroke-gray-700'} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="21" cy="8" r=".7" className="fill-white" />
      {weaned && <path d="m3 3 2.4 2.6L10 .8" className="stroke-green-700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
    </svg>
  )
}

/** So viele Lamm-Symbole, wie Junge gerade mitlaufen und saugen (ab 5 «+»); der Tooltip nennt die Zahl. */
export default function NursingLambs({ count, young = 'Lämmer' }: { count: number; young?: string }) {
  if (count <= 0) return null
  const shown = Math.min(count, 4)
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded bg-green-100 px-1.5 py-0.5 text-green-900"
      title={`${count} ${young} laufen mit und saugen`}
      aria-label={`${count} ${young} saugen`}
    >
      <span className="flex -space-x-1">
        {Array.from({ length: shown }, (_, i) => (
          <LambIcon key={i} />
        ))}
      </span>
      {count > 4 && <span className="text-[11px] font-bold">+{count - 4}</span>}
      {count <= 4 && count > 1 && <span className="ml-0.5 text-[11px] font-bold">{count}</span>}
    </span>
  )
}

/** Erfolgreich abgesetzte Lämmer des letzten Wurfs: Umriss-Lämmer in Blau mit grünem Haken (saugende sind gefüllt und grün),
 * dazu «3 von 4» (abgesetzt von lebend geboren). */
export function WeanedLambs({ count, alive, dead, young = 'Lämmer' }: { count: number; alive: number; dead: number; young?: string }) {
  if (count <= 0) return null
  const shown = Math.min(count, 4)
  const title = `${count} ${young} des letzten Wurfs erfolgreich abgesetzt (${alive} lebend geboren${dead > 0 ? `, ${dead} verendet` : ''})`
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-sky-900" title={title} aria-label={title}>
      <span className="flex -space-x-1">
        {Array.from({ length: shown }, (_, i) => (
          <LambIcon key={i} weaned />
        ))}
      </span>
      {count > 4 && <span className="text-[11px] font-bold">+{count - 4}</span>}
      <span className="ml-0.5 text-[11px] font-bold">{count}/{alive}</span>
    </span>
  )
}
