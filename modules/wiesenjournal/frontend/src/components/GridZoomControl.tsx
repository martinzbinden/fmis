import { useGridZoom } from '../hooks/useGridZoom'

export default function GridZoomControl() {
  const { canZoomIn, canZoomOut, zoomIn, zoomOut } = useGridZoom()
  return (
    <div className="flex items-center overflow-hidden rounded border border-gray-300">
      <button
        type="button"
        onClick={zoomOut}
        disabled={!canZoomOut}
        aria-label="Raster schmaler"
        title="Weniger Platz pro Tag (mehr Tage sichtbar)"
        className="px-2 py-1 text-sm text-gray-600 disabled:opacity-30"
      >
        −
      </button>
      <span className="px-1 text-xs text-gray-400">🔍</span>
      <button
        type="button"
        onClick={zoomIn}
        disabled={!canZoomIn}
        aria-label="Raster breiter"
        title="Mehr Platz pro Tag (besser lesbar)"
        className="px-2 py-1 text-sm text-gray-600 disabled:opacity-30"
      >
        +
      </button>
    </div>
  )
}
