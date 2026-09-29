import { useGridView } from '../hooks/useGridView'

export default function GridViewToggle() {
  const [view, setView] = useGridView()
  return (
    <div className="flex overflow-hidden rounded border border-gray-300 text-xs">
      <button
        type="button"
        onClick={() => setView('neu')}
        className={`px-2 py-1 font-medium ${view === 'neu' ? 'bg-brand-600 text-white' : 'text-gray-600'}`}
      >
        Neu
      </button>
      <button
        type="button"
        onClick={() => setView('klassisch')}
        className={`px-2 py-1 font-medium ${view === 'klassisch' ? 'bg-brand-600 text-white' : 'text-gray-600'}`}
      >
        Klassisch
      </button>
    </div>
  )
}
