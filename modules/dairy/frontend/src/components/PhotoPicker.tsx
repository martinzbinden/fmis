import { useState } from 'react'
import { toWebp, type PreparedPhoto } from '../lib/photos'

/** Fotos zu einem Eintrag: aufnehmen oder aus der Galerie, sofort verkleinert
 * (WebP). Gespeichert werden sie erst mit dem Eintrag (lib/photos.ts savePhotos). */
export default function PhotoPicker({ photos, onChange, disabledReason }: { photos: PreparedPhoto[]; onChange: (p: PreparedPhoto[]) => void; disabledReason?: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      const added: PreparedPhoto[] = []
      for (const f of Array.from(files)) added.push(await toWebp(f))
      onChange([...photos, ...added])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Foto liess sich nicht verarbeiten.')
    } finally {
      setBusy(false)
    }
  }

  if (disabledReason) return <p className="text-sm text-gray-600">📷 {disabledReason}</p>
  return (
    <div className="space-y-2">
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
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
