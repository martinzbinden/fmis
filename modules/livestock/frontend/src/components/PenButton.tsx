/** Ein Stift je Zeile: öffnet das Bearbeiten, erst dort gibt es «Löschen». */
export default function PenButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-lg text-brand-700 active:bg-gray-100"
    >
      ✎
    </button>
  )
}
