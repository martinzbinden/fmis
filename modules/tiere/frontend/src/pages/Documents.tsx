import { useCallback, useEffect, useState } from 'react'
import { useHasPermission } from '@fmis/core/AuthContext'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { deleteDocument, DOCUMENT_TOPICS, fmtSize, loadDocuments, openDocument, uploadDocument, type TierDocument } from '../lib/documents'

const field = 'min-h-11 w-full rounded-lg border-2 border-gray-400 px-3 text-base focus:border-brand-700 focus:outline-none'

/** Merkblätter des Betriebs (z.B. Nutztiertransporte): ansehen, hochladen, entfernen. Die Dateien liegen nur auf dem
 * Server der Instanz (backend/app/documents.py). */
export default function Documents() {
  const canWrite = useHasPermission('tiere:herden:write')
  const [docs, setDocs] = useState<TierDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<{ title: string; source: string; topic: TierDocument['topic'] }>({ title: '', source: '', topic: 'transport' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    loadDocuments()
      .then((d) => {
        setDocs(d)
        setError(null)
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])
  useEffect(load, [load])

  async function save() {
    if (!file) return
    setBusy(true)
    try {
      await uploadDocument(file, meta)
      notifySuccess('Merkblatt gespeichert')
      setAdding(false)
      setFile(null)
      setMeta({ title: '', source: '', topic: 'transport' })
      load()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function remove(d: TierDocument) {
    if (!window.confirm(`«${d.title}» entfernen?`)) return
    try {
      await deleteDocument(d.id)
      load()
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 pb-24">
      <h1 className="text-xl font-bold text-gray-900">Merkblätter</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!docs && !error && <p className="text-center text-sm text-gray-500">Lädt…</p>}
      {docs && docs.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Noch keine Merkblätter. {canWrite ? 'Mit «＋ Merkblatt» ein PDF hochladen.' : ''}</p>}
      {docs && docs.length > 0 && (
        <ul className="divide-y rounded-lg bg-white shadow-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2">
              <button type="button" onClick={() => void openDocument(d).catch((e: unknown) => notifyError(errorText(e)))} className="min-h-11 min-w-0 flex-1 text-left">
                <span className="block font-semibold text-brand-800">📄 {d.title}</span>
                <span className="block text-xs text-gray-600">
                  {[d.source, DOCUMENT_TOPICS.find((t) => t.key === d.topic)?.label, fmtSize(d.size_bytes)].filter(Boolean).join(' · ')}
                </span>
              </button>
              {canWrite && (
                <button type="button" onClick={() => void remove(d)} aria-label={`«${d.title}» entfernen`} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-red-700">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-600">
        Rechtliche Grundlage für den Platz beim Transport:{' '}
        <a href="https://www.fedlex.admin.ch/eli/cc/2008/416/de" target="_blank" rel="noreferrer" className="text-brand-700 underline">
          Tierschutzverordnung (TSchV)
        </a>
        , Anhang 4. Fahrzeit und Transportdauer (höchstens 8 Stunden):{' '}
        <a href="https://www.blv.admin.ch/dam/de/sd-web/prjzlxDGNguC/fachinformation-15.5-de.pdf" target="_blank" rel="noreferrer" className="text-brand-700 underline">
          BLV-Fachinformation 15.5
        </a>
        .
      </p>

      {canWrite && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="min-h-11 w-full rounded-lg border-2 border-dashed border-brand-700 font-semibold text-brand-800">
          ＋ Merkblatt
        </button>
      )}
      {canWrite && adding && (
        <section className="space-y-2 rounded-lg border-2 border-brand-700 bg-white p-3 text-sm">
          <label className="block font-medium text-gray-800">
            Datei (PDF oder Bild)
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                if (f && !meta.title) setMeta((m) => ({ ...m, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }))
              }}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <label className="block font-medium text-gray-800">
            Titel
            <input className={field} value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} />
          </label>
          <label className="block font-medium text-gray-800">
            Herausgeber (frei)
            <input className={field} value={meta.source} onChange={(e) => setMeta((m) => ({ ...m, source: e.target.value }))} placeholder="z.B. Beratungsstelle, Jahr" />
          </label>
          <label className="block font-medium text-gray-800">
            Thema
            <select className={field} value={meta.topic ?? ''} onChange={(e) => setMeta((m) => ({ ...m, topic: (e.target.value || null) as TierDocument['topic'] }))}>
              {DOCUMENT_TOPICS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-gray-600">«Transport»: erscheint bei den Tiergruppen neben dem Platzbedarf.</span>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 rounded-lg border-2 border-gray-300 px-4">
              Abbrechen
            </button>
            <button type="button" disabled={!file || busy} onClick={() => void save()} className="min-h-11 flex-1 rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
              {busy ? 'Lädt hoch…' : 'Hochladen'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
