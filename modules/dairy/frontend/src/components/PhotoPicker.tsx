import { useState } from 'react'
import { toWebp, type PreparedPhoto } from '../lib/photos'

/** Fotos zu einem Eintrag: aufnehmen oder aus der Galerie, sofort verkleinert
 * (WebP). Gespeichert werden sie erst mit dem Eintrag (lib/photos.ts savePhotos). */
export default function PhotoPicker({ photos, onChange, disabledReason }: { photos: PreparedPhoto[]; onChange: (p: PreparedPhoto[]) => void; disabledReason?: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  async function add(files: FileList | null) {
    // beim Ziehen aus dem Explorer kommen auch andere Dateien mit
    const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
    if (!images.length) {
      if (files?.length) setError('Nur Fotos (Bilddateien) möglich.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const added: PreparedPhoto[] = []
      for (const f of images) added.push(await toWebp(f))
      onChange([...photos, ...added])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Foto liess sich nicht verarbeiten.')
    } finally {
      setBusy(false)
    }
  }

  if (disabledReason) return <p className="text-sm text-gray-600">📷 {disabledReason}</p>
  // am PC: Fotos auch hierher ziehen (Drag & Drop)
  return (
    <div
      className={`space-y-2 rounded-lg ${over ? 'bg-brand-50 outline-dashed outline-2 outline-brand-700' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        void add(e.dataTransfer.files)
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p, i) => (
          <span key={p.preview} className="relative">
            <img src={p.preview} alt={`Foto ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(p.preview)
                onChange(photos.filter((x) => x !== p))
              }}
              className="absolute -right-2 -top-2 grid h-11 w-11 place-items-center"
              aria-label={`Foto ${i + 1} entfernen`}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gray-900/80 text-white">×</span>
            </button>
          </span>
        ))}
        <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 ${busy ? 'opacity-50' : ''}`}>
          📷 {busy ? 'Verarbeite…' : photos.length ? 'Weiteres Foto' : 'Foto'}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => {
              void add(e.target.files)
              e.target.value = ''
            }}
            className="sr-only"
          />
        </label>
        <span className="hidden text-xs text-gray-500 [@media(pointer:fine)]:inline">oder Foto hierher ziehen</span>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
