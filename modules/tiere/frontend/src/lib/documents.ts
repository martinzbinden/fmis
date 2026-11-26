// Merkblätter der Instanz (backend/app/documents.py): Liste beim Öffnen vom Server, Inhalt erst beim Anzeigen und
// danach im Browser-Cache (auch ohne Netz). Fremde Dokumente liegen nur auf dem Server, nie im Repo.

import { API_URL, getToken } from '@fmis/core/auth'
import type { DocKind } from './docMeta'

export interface TierDocument {
  id: string
  title: string
  filename: string
  content_type: string
  size_bytes: number
  source: string | null
  /** Stichwort, über das andere Seiten ein Merkblatt finden (z.B. «transport» für die Tiergruppen) */
  topic: 'transport' | 'allgemein' | null
  uploaded_at: string
  /** Link zur Quelle; damit prüft der Server, ob es eine neue Version gibt */
  url: string | null
  /** 'formular' = PDF mit Formularfeldern (ausfüllbar) */
  kind: DocKind
  /** Formular, das FMIS selbst ausfüllt (lib/docMeta.ts FORM_TYPES) */
  form_key: string | null
  /** z.B. «Auflage 2023» */
  edition: string | null
  checked_at: string | null
  check_status: 'aktuell' | 'neu' | 'fehler' | null
  check_note: string | null
}

export type DocInput = Pick<TierDocument, 'title' | 'source' | 'topic' | 'url' | 'kind' | 'form_key' | 'edition'>

export const DOCUMENT_TOPICS: { key: NonNullable<TierDocument['topic']>; label: string }[] = [
  { key: 'transport', label: 'Transport' },
  { key: 'allgemein', label: 'Allgemein' },
]

/** Amtliche Formulare zum Ausfüllen: offizielle Bezugsquelle (BLV), auf der Instanz hinterlegt statt im Repo. */
export const FORM_SOURCE = 'https://www.blv.admin.ch/de/tiertransporte'

/** Formular, das FMIS ausfüllt (z.B. «begleitdokument_klauentiere»); ältere Ablagen hatten dafür ein Thema «vorlage_…». */
export function findForm(docs: TierDocument[], key: string): TierDocument | undefined {
  const legacy: Record<string, string> = { begleitdokument_klauentiere: 'vorlage_begleitdokument', tierliste_klauentiere: 'vorlage_tierliste' }
  return docs.find((d) => d.form_key === key) ?? docs.find((d) => (d.topic as string | null) === legacy[key])
}

const base = `${API_URL}/tiere/documents`
const auth = () => ({ Authorization: `Bearer ${getToken()}` })
const CACHE = 'fmis-tiere-documents'
const LIST_KEY = 'fmis_tiere_documents'

async function failed(res: Response, what: string): Promise<never> {
  const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail
  throw new Error(detail ?? `${what} (${res.status})`)
}

/** Liste vom Server; ohne Netz die zuletzt geholte. */
export async function loadDocuments(): Promise<TierDocument[]> {
  try {
    const res = await fetch(base, { headers: auth() })
    if (!res.ok) return failed(res, 'Merkblätter nicht verfügbar')
    const list = (await res.json()) as TierDocument[]
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list))
    } catch {
      /* Speicher voll oder gesperrt */
    }
    return list
  } catch (e) {
    try {
      const stored = localStorage.getItem(LIST_KEY)
      if (stored) return JSON.parse(stored) as TierDocument[]
    } catch {
      /* nichts gespeichert */
    }
    throw e instanceof TypeError ? new Error('Keine Verbindung zum Server.') : e
  }
}

/** Zuletzt geholte Liste ohne Netz (z.B. für den Link auf das Transport-Merkblatt). */
export function storedDocuments(): TierDocument[] {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]') as TierDocument[]
  } catch {
    return []
  }
}

/** Inhalt eines Dokuments, nach dem ersten Mal aus dem Cache (auch ohne Netz). */
export async function fetchFile(id: string): Promise<Blob> {
  const url = `${base}/${id}`
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null
  const cached = await cache?.match(url)
  if (cached) return cached.blob()
  let res: Response
  try {
    res = await fetch(url, { headers: auth() })
  } catch {
    throw new Error('Das Merkblatt ist noch nicht auf diesem Gerät; zum ersten Öffnen braucht es Netz.')
  }
  if (!res.ok) return failed(res, 'Merkblatt nicht verfügbar')
  await cache?.put(url, res.clone()).catch(() => undefined)
  return res.blob()
}

/** Öffnen: Computer (eigene PDF-Anzeige) in neuem Tab, Handy als Datei an den PDF-Betrachter (wie Maschinen). */
export async function openDocument(doc: Pick<TierDocument, 'id' | 'filename'>): Promise<void> {
  const inTab = navigator.pdfViewerEnabled === true
  const win = inTab ? window.open('', '_blank') : null
  try {
    const url = URL.createObjectURL(await fetchFile(doc.id))
    if (win) {
      win.location.href = url
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = doc.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) {
    win?.close()
    throw e
  }
}

async function call(path: string, init: RequestInit, what: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, { ...init, headers: { ...auth(), ...(init.headers ?? {}) } })
  } catch {
    throw new Error(`${what} braucht eine Verbindung zum Server.`)
  }
  if (!res.ok) await failed(res, `${what} fehlgeschlagen`)
  return res
}

const metaParams = (m: Partial<DocInput>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(m)) if (typeof v === 'string' && v.trim()) p.set(k, v.trim())
  return p
}

export async function uploadDocument(file: File, meta: DocInput): Promise<void> {
  const params = metaParams(meta)
  params.set('filename', file.name)
  params.set('title', meta.title.trim() || file.name.replace(/\.[^.]+$/, ''))
  await call(`?${params}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/pdf' }, body: file }, 'Hochladen')
}

/** Datei hinter einem Link über den Server holen (der Browser darf fremde Seiten nicht lesen). */
export async function fetchFromUrl(url: string): Promise<File> {
  const res = await call(`/fetch?${new URLSearchParams({ url: url.trim() })}`, { method: 'POST' }, 'Laden vom Link')
  const name = decodeURIComponent(res.headers.get('X-Filename') ?? 'dokument.pdf')
  const blob = await res.blob()
  return new File([blob], name, { type: blob.type || 'application/pdf' })
}

export async function patchDocument(id: string, meta: Partial<DocInput>): Promise<void> {
  await call(`/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }, 'Speichern')
}

/** Liegt unter dem Link noch dieselbe Datei? */
export async function checkDocument(id: string): Promise<{ status: 'aktuell' | 'neu' | 'fehler'; note: string | null }> {
  return (await call(`/${id}/check`, { method: 'POST' }, 'Prüfen')).json() as Promise<{ status: 'aktuell' | 'neu' | 'fehler'; note: string | null }>
}

/** Neue Version vom Link übernehmen (Angaben bleiben, die alte Datei wird ersetzt). */
export async function updateFromUrl(id: string): Promise<string> {
  return ((await (await call(`/${id}/update`, { method: 'POST' }, 'Neue Version')).json()) as { id: string }).id
}

/** Links, die länger als `days` Tage nicht geprüft wurden. */
export const dueForCheck = (docs: TierDocument[], now: number, days = 7) =>
  docs.filter((d) => d.url && (!d.checked_at || now - Date.parse(d.checked_at) > days * 86_400_000))

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${base}/${id}`, { method: 'DELETE', headers: auth() }).catch(() => null)
  if (!res) throw new Error('Löschen braucht eine Verbindung zum Server.')
  if (!res.ok) await failed(res, 'Löschen fehlgeschlagen')
}

export function fmtSize(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} kB`
}
