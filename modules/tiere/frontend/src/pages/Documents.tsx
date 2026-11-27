import { useCallback, useEffect, useRef, useState } from 'react'
import { useHasPermission } from '@fmis/core/AuthContext'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { extractMeta, formLabel, FORM_TYPES } from '../lib/docMeta'
import {
  checkDocument,
  deleteDocument,
  DOCUMENT_TOPICS,
  dueForCheck,
  fetchFromUrl,
  fmtSize,
  loadDocuments,
  openDocument,
  patchDocument,
  updateFromUrl,
  uploadDocument,
  type DocInput,
  type TierDocument,
} from '../lib/documents'

const field = 'min-h-11 w-full rounded-lg border-2 border-gray-400 px-3 text-base focus:border-brand-700 focus:outline-none'
const EMPTY: DocInput = { title: '', source: '', topic: 'allgemein', url: '', kind: 'merkblatt', form_key: null, edition: '' }
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('de-CH')

/** Titel, Herausgeber, Ausgabe, Thema, Link, Art — beim Hochladen (vorgeschlagen) und beim Bearbeiten. */
function MetaFields({ meta, onChange }: { meta: DocInput; onChange: (m: DocInput) => void }) {
  const set = (p: Partial<DocInput>) => onChange({ ...meta, ...p })
  return (
    <>
      <label className="block font-medium text-gray-800">
        Titel
        <input className={field} value={meta.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block font-medium text-gray-800">
          Herausgeber
          <input className={field} value={meta.source ?? ''} onChange={(e) => set({ source: e.target.value })} placeholder="z.B. BLV" />
        </label>
        <label className="block font-medium text-gray-800">
          Ausgabe
          <input className={field} value={meta.edition ?? ''} onChange={(e) => set({ edition: e.target.value })} placeholder="z.B. Auflage 2023" />
        </label>
      </div>
      <label className="block font-medium text-gray-800">
        Link zur Quelle (freiwillig)
        <input className={field} type="url" inputMode="url" value={meta.url ?? ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" />
        <span className="text-xs font-normal text-gray-600">Mit Link prüft FMIS jede Woche, ob dort eine neue Version liegt.</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block font-medium text-gray-800">
          Thema
          <select className={field} value={meta.topic ?? ''} onChange={(e) => set({ topic: (e.target.value || null) as DocInput['topic'] })}>
            {DOCUMENT_TOPICS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block font-medium text-gray-800">
          Art
          <select className={field} value={meta.form_key ?? meta.kind} onChange={(e) => (FORM_TYPES.some((t) => t.key === e.target.value) ? set({ kind: 'formular', form_key: e.target.value }) : set({ kind: e.target.value as DocInput['kind'], form_key: null }))}>
            <option value="merkblatt">Merkblatt</option>
            <option value="formular">Formular (ausfüllbar)</option>
            {FORM_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                Formular: {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {meta.topic === 'transport' && <p className="text-xs text-gray-600">«Transport»: erscheint bei den Tiergruppen neben dem Platzbedarf.</p>}
      {meta.form_key && <p className="text-xs text-green-800">✍️ FMIS füllt dieses Formular aus (Begleitdokument aus einer Tiergruppe).</p>}
    </>
  )
}

function Status({ d }: { d: TierDocument }) {
  if (!d.url) return null
  if (d.check_status === 'neu') return <span className="rounded bg-amber-100 px-1.5 font-semibold text-amber-900">neue Version unter dem Link</span>
  if (d.check_status === 'fehler')
    return (
      <span className="basis-full text-red-700">
        🔗 Prüfen ging nicht{d.checked_at ? ` (${fmtDay(d.checked_at)})` : ''}
        {d.check_note && <span className="block break-words text-red-800/90">Grund: {d.check_note}</span>}
      </span>
    )
  if (d.check_status === 'aktuell' && d.checked_at) return <span className="text-green-800">🔗 aktuell, geprüft {fmtDay(d.checked_at)}</span>
  return <span>🔗 Link</span>
}

/** Merkblätter und Formulare des Betriebs: hineinziehen, einfügen oder per Link holen; Angaben schlägt FMIS aus der
 * Datei vor. Die Dateien liegen nur auf dem Server der Instanz (backend/app/documents.py). */
export default function Documents() {
  const canWrite = useHasPermission('tiere:herden:write')
  const [docs, setDocs] = useState<TierDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<DocInput>(EMPTY)
  const [reading, setReading] = useState(false)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState<{ id: string; meta: DocInput } | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const checked = useRef(false)

  const load = useCallback(() => {
    loadDocuments()
      .then((d) => {
        setDocs(d)
        setError(null)
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])
  useEffect(load, [load])

  // Links wöchentlich prüfen, beim Öffnen der Seite (nur wer ablegen darf; der Server holt die Dateien)
  useEffect(() => {
    if (!canWrite || !docs || checked.current) return
    checked.current = true
    const due = dueForCheck(docs, Date.now())
    if (due.length === 0) return
    void (async () => {
      for (const d of due) await checkDocument(d.id).catch(() => undefined)
      load()
    })()
  }, [canWrite, docs, load])

  const take = useCallback(async (f: File, url = '') => {
    setFile(f)
    setReading(true)
    setMeta({ ...EMPTY, url })
    try {
      const m = await extractMeta(f, f.name)
      setMeta({ ...m, url })
    } catch {
      setMeta({ ...EMPTY, title: f.name.replace(/\.[^.]+$/, ''), url })
    } finally {
      setReading(false)
    }
  }, [])

  const fromLink = useCallback(
    async (url: string) => {
      setBusy('link')
      try {
        await take(await fetchFromUrl(url), url.trim())
        setLink('')
      } catch (e) {
        notifyError(errorText(e))
      } finally {
        setBusy(null)
      }
    },
    [take],
  )

  // Einfügen (Strg+V / lange drücken → Einfügen): Datei aus der Zwischenablage oder ein Link
  useEffect(() => {
    if (!canWrite) return
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select') && !(target as HTMLInputElement).dataset?.pasteTarget) return
      const f = [...(e.clipboardData?.files ?? [])].find((x) => ACCEPT.includes(x.type))
      if (f) {
        e.preventDefault()
        void take(f)
        return
      }
      const text = e.clipboardData?.getData('text') ?? ''
      if (isUrl(text)) {
        e.preventDefault()
        void fromLink(text)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [canWrite, take, fromLink])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = [...e.dataTransfer.files].find((x) => ACCEPT.includes(x.type))
    if (f) return void take(f)
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text')
    if (isUrl(url)) return void fromLink(url)
    notifyError('Nur PDF oder Bild (JPEG, PNG, WebP)')
  }

  async function save() {
    if (!file) return
    setBusy('save')
    try {
      await uploadDocument(file, meta)
      notifySuccess(meta.kind === 'formular' ? 'Formular gespeichert' : 'Merkblatt gespeichert')
      setFile(null)
      setMeta(EMPTY)
      load()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  async function act(id: string, what: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(`${what}:${id}`)
    try {
      await fn()
      if (ok) notifySuccess(ok)
      load()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = (d: TierDocument) => window.confirm(`«${d.title}» entfernen?`) && void act(d.id, 'del', () => deleteDocument(d.id))
  const check = (d: TierDocument) =>
    void act(d.id, 'check', async () => {
      const r = await checkDocument(d.id)
      notifySuccess(r.status === 'aktuell' ? 'Unter dem Link liegt dieselbe Datei.' : r.status === 'neu' ? 'Unter dem Link liegt eine neue Version.' : `Prüfen ging nicht: ${r.note ?? ''}`)
    })

  // als Funktion, nicht als Komponente: sonst verlöre das Eingabefeld beim Tippen den Fokus
  function row(d: TierDocument) {
    if (editing?.id === d.id)
      return (
        <li key={d.id} className="space-y-2 bg-brand-50 px-3 py-3 text-sm">
          <MetaFields meta={editing.meta} onChange={(m) => setEditing({ id: d.id, meta: m })} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(null)} aria-label="Abbrechen" className="min-h-11 rounded-lg border-2 border-gray-300 px-4">
              ✕
            </button>
            <button
              type="button"
              disabled={!editing.meta.title.trim() || !!busy}
              onClick={() => void act(d.id, 'edit', () => patchDocument(d.id, editing.meta), 'Gespeichert').then(() => setEditing(null))}
              aria-label="Speichern"
              className="min-h-11 flex-1 rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40"
            >
              ✓ Speichern
            </button>
          </div>
        </li>
      )
    return (
      <li key={d.id} className="space-y-1 px-3 py-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void openDocument(d).catch((e: unknown) => notifyError(errorText(e)))} className="min-h-11 min-w-0 flex-1 text-left">
            <span className="block font-semibold text-brand-800">
              {d.kind === 'formular' ? '✍️' : '📄'} {d.title}
            </span>
            <span className="block text-xs text-gray-600">
              {[d.source, d.edition, DOCUMENT_TOPICS.find((t) => t.key === d.topic)?.label, fmtSize(d.size_bytes)].filter(Boolean).join(' · ')}
            </span>
          </button>
          {canWrite && (
            <>
              <button type="button" onClick={() => setEditing({ id: d.id, meta: { title: d.title, source: d.source ?? '', topic: d.topic, url: d.url ?? '', kind: d.kind, form_key: d.form_key, edition: d.edition ?? '' } })} aria-label={`«${d.title}» bearbeiten`} className="min-h-11 shrink-0 rounded-lg px-2.5 text-gray-700">
                ✎
              </button>
              <button type="button" onClick={() => remove(d)} aria-label={`«${d.title}» entfernen`} className="min-h-11 shrink-0 rounded-lg px-2.5 text-red-700">
                ✕
              </button>
            </>
          )}
        </div>
        {(d.url || d.form_key) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
            {d.form_key && <span className="text-green-800">FMIS füllt aus: {formLabel(d.form_key)}</span>}
            <Status d={d} />
            {d.url && (
              <a href={d.url} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                Quelle
              </a>
            )}
            {canWrite && d.url && d.check_status !== 'neu' && (
              <button type="button" disabled={!!busy} onClick={() => check(d)} className="min-h-9 text-brand-700 underline disabled:opacity-40">
                {busy === `check:${d.id}` ? 'prüft…' : '↻ jetzt prüfen'}
              </button>
            )}
            {canWrite && d.check_status === 'neu' && (
              <button type="button" disabled={!!busy} onClick={() => void act(d.id, 'update', () => updateFromUrl(d.id), 'Neue Version übernommen')} className="min-h-9 rounded-lg bg-amber-600 px-3 font-semibold text-white disabled:opacity-40">
                {busy === `update:${d.id}` ? 'lädt…' : '⬇ Neue Version übernehmen'}
              </button>
            )}
          </div>
        )}
      </li>
    )
  }

  const sections: [string, TierDocument[]][] = [
    ['Merkblätter', (docs ?? []).filter((d) => d.kind !== 'formular')],
    ['Formulare zum Ausfüllen', (docs ?? []).filter((d) => d.kind === 'formular')],
  ]

  return (
    <div
      className="mx-auto max-w-2xl space-y-3 p-3 pb-24"
      onDragOver={(e) => {
        if (!canWrite) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => canWrite && onDrop(e)}
    >
      <h1 className="text-xl font-bold text-gray-900">Merkblätter</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!docs && !error && <p className="text-center text-sm text-gray-500">Lädt…</p>}

      {canWrite && !file && (
        <section className={`space-y-2 rounded-lg border-2 border-dashed p-3 text-sm ${dragging ? 'border-brand-700 bg-brand-50' : 'border-gray-400 bg-white'}`} aria-label="Merkblatt ablegen">
          <button type="button" onClick={() => picker.current?.click()} className="min-h-14 w-full rounded-lg font-semibold text-brand-800">
            ＋ PDF hierher ziehen, einfügen oder antippen
          </button>
          <input ref={picker} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void take(e.target.files[0])} />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (isUrl(link)) void fromLink(link)
            }}
          >
            <input className={field} type="url" inputMode="url" data-paste-target="1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="oder Link einfügen (https://…pdf)" aria-label="Link zum PDF" />
            <button type="submit" disabled={!isUrl(link) || busy === 'link'} className="min-h-11 shrink-0 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-40">
              {busy === 'link' ? '…' : 'Laden'}
            </button>
          </form>
        </section>
      )}

      {canWrite && file && (
        <section className="space-y-2 rounded-lg border-2 border-brand-700 bg-white p-3 text-sm" aria-label="Neues Merkblatt">
          <p className="text-gray-700">
            <span className="font-semibold text-gray-900">{file.name}</span> · {fmtSize(file.size)}
            {reading ? ' · liest die Datei…' : ' · Angaben aus der Datei vorgeschlagen, bitte prüfen'}
          </p>
          <MetaFields meta={meta} onChange={setMeta} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setFile(null)
                setMeta(EMPTY)
              }}
              className="min-h-11 rounded-lg border-2 border-gray-300 px-4"
            >
              Abbrechen
            </button>
            <button type="button" disabled={reading || !meta.title.trim() || busy === 'save'} onClick={() => void save()} className="min-h-11 flex-1 rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
              {busy === 'save' ? 'Lädt hoch…' : 'Speichern'}
            </button>
          </div>
        </section>
      )}

      {docs && docs.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Noch keine Merkblätter.</p>}
      {sections.map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title} className="space-y-1">
              <h2 className="px-1 text-sm font-semibold uppercase tracking-wide text-gray-600">{title}</h2>
              <ul className="divide-y rounded-lg bg-white shadow-sm">
                {list.map(row)}
              </ul>
            </section>
          ),
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
        . Leere Formulare (Begleitdokument, Tierliste):{' '}
        <a href="https://www.blv.admin.ch/de/tiertransporte" target="_blank" rel="noreferrer" className="text-brand-700 underline">
          BLV Tiertransporte
        </a>
        .
      </p>
    </div>
  )
}
