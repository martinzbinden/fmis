import { useEffect, useState } from 'react'
import { photoObjectUrl } from './photos'
import { errorText } from './toast'

function Thumb({ moduleKey, id, onOpen }: { moduleKey: string; id: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    photoObjectUrl(moduleKey, id, true).then(
      (u) => live && setUrl(u),
      (e: unknown) => live && setError(errorText(e, 'nicht verfügbar')),
    )
    return () => {
      live = false
    }
  }, [moduleKey, id])
  if (error) return <span className="grid h-16 w-16 place-items-center rounded-lg bg-gray-100 p-1 text-center text-xs leading-tight text-gray-600">{error}</span>
  if (!url) return <span className="h-16 w-16 animate-pulse rounded-lg bg-gray-100" />
  return (
    <button type="button" onClick={onOpen} className="shrink-0" aria-label="Foto gross anzeigen">
      <img src={url} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
    </button>
  )
}

function Viewer({ moduleKey, id, onClose }: { moduleKey: string; id: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    photoObjectUrl(moduleKey, id).then(
      (u) => live && setUrl(u),
      (e: unknown) => live && setError(errorText(e, 'Foto nicht verfügbar')),
    )
    return () => {
      live = false
    }
  }, [moduleKey, id])
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-black/90" role="dialog" aria-label="Foto">
      <button type="button" onClick={onClose} className="grid min-h-0 flex-1 place-items-center p-2" aria-label="Foto schliessen">
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-white">{error ?? 'Lädt…'}</span>}
      </button>
      <div className="flex justify-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <button type="button" onClick={onClose} className="min-h-12 rounded-lg bg-white/90 px-4 text-sm font-semibold text-gray-900">
          ✕ Schliessen
        </button>
      </div>
    </div>
  )
}

/** Fotos eines Eintrags: zuerst nur «📷 N» (lädt nichts), aufgeklappt die Vorschauen, angetippt das Foto. */
export default function PhotoStrip({ moduleKey, ids, startOpen = false }: { moduleKey: string; ids: string[]; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [big, setBig] = useState<string | null>(null)
  if (!ids.length) return null
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-medium text-gray-700 active:bg-gray-100">
        📷 {ids.length} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <Thumb key={id} moduleKey={moduleKey} id={id} onOpen={() => setBig(id)} />
          ))}
        </div>
      )}
      {big && <Viewer moduleKey={moduleKey} id={big} onClose={() => setBig(null)} />}
    </div>
  )
}
