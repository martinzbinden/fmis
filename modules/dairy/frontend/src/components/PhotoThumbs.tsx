import { useEffect, useState } from 'react'
import { photoObjectUrl, type JournalPhoto } from '../lib/photos'

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

/** Fotos eines Journal-Eintrags; Antippen zeigt das Foto bildschirmfüllend. */
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
      {open && (
        <button type="button" onClick={() => setOpen(null)} className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-2" aria-label="Foto schliessen">
          <img src={open} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </>
  )
}
