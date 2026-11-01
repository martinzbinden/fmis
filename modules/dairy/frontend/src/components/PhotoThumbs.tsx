import { useEffect, useState } from 'react'
import { errorText, notifyError } from '@fmis/core/toast'
import { canSharePhoto, photoObjectUrl, searchWithGoogleLens, sharePhoto, type JournalPhoto } from '../lib/photos'

function Thumb({ moduleKey, photo, onOpen }: { moduleKey: string; photo: JournalPhoto; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    photoObjectUrl(moduleKey, photo.id).then(
      (u) => live && setUrl(u),
      (e: unknown) => live && setError(e instanceof Error ? e.message : 'Foto nicht verfügbar'),
    )
    return () => {
      live = false
    }
  }, [moduleKey, photo.id])
  if (error) return <span className="grid h-16 w-16 place-items-center rounded-lg bg-gray-100 p-1 text-center text-[11px] leading-tight text-gray-600">{error}</span>
  if (!url) return <span className="h-16 w-16 animate-pulse rounded-lg bg-gray-100" />
  return (
    <button type="button" onClick={() => onOpen(url)} className="shrink-0" aria-label="Foto gross anzeigen">
      <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" />
    </button>
  )
}

/** Fotos eines Eintrags; Antippen zeigt das Foto bildschirmfüllend, mit
 * Bildsuche bei Google und Teilen zur weiteren Recherche. */
export default function PhotoThumbs({ moduleKey, photos }: { moduleKey: string; photos: JournalPhoto[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!photos.length) return null
  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {photos.map((p) => (
          <Thumb key={p.id} moduleKey={moduleKey} photo={p} onOpen={setOpen} />
        ))}
      </div>
      {open && <PhotoViewer url={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const [share, setShare] = useState(false)
  useEffect(() => {
    void canSharePhoto().then(setShare)
  }, [])
  const run = (fn: (u: string) => Promise<void>) => () => void fn(url).catch((e) => notifyError(errorText(e)))
  const btn = 'min-h-11 rounded-lg bg-white/90 px-3 text-sm font-semibold text-gray-900 active:bg-white'
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-label="Foto">
      <button type="button" onClick={onClose} className="grid min-h-0 flex-1 place-items-center p-2" aria-label="Foto schliessen">
        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      </button>
      <div className="flex flex-wrap items-center justify-center gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <button type="button" onClick={run(searchWithGoogleLens)} className={btn}>
          🔍 Bildsuche (Google)
        </button>
        {share && (
          <button type="button" onClick={run(sharePhoto)} className={btn}>
            ↗ Teilen
          </button>
        )}
        <button type="button" onClick={onClose} className={btn}>
          ✕ Schliessen
        </button>
        <p className="w-full text-center text-xs text-gray-300">Bildsuche und Teilen schicken das Foto an Google bzw. die gewählte App.</p>
      </div>
    </div>
  )
}
