import type { ServerHistory } from './historyApi'

/**
 * Knopf «Ältere Einträge laden» unter einer Verlaufsliste. Bekommt das Ergebnis
 * von useServerHistory() und zeigt sich nur, wenn es vermutlich mehr gibt.
 */
export default function HistoryLoadMore({ history }: { history: Pick<ServerHistory, 'entries' | 'hasMore' | 'loadMore' | 'loadingMore' | 'moreError'> }) {
  const { entries, hasMore, loadMore, loadingMore, moreError } = history
  if (!entries || entries.length === 0) return null
  if (!hasMore && !moreError) {
    return <p className="text-center text-xs text-gray-400">{entries.length} Einträge – keine älteren</p>
  }
  return (
    <div className="space-y-1 text-center">
      {moreError && <p className="text-sm text-amber-800">{moreError}</p>}
      <button
        type="button"
        disabled={loadingMore}
        onClick={loadMore}
        className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm disabled:opacity-50"
      >
        {loadingMore ? 'Lädt …' : moreError ? 'Nochmals versuchen' : 'Ältere Einträge laden'}
      </button>
      <p className="text-xs text-gray-500">{entries.length} Einträge geladen</p>
    </div>
  )
}
