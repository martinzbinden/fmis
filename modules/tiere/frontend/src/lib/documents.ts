// Merkblätter der Instanz (backend/app/documents.py): Liste beim Öffnen vom Server, Inhalt erst beim Anzeigen und
// danach im Browser-Cache (auch ohne Netz). Fremde Dokumente liegen nur auf dem Server, nie im Repo.

import { API_URL, getToken } from '@fmis/core/auth'

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
}

export const DOCUMENT_TOPICS: { key: NonNullable<TierDocument['topic']>; label: string }[] = [
  { key: 'transport', label: 'Transport' },
  { key: 'allgemein', label: 'Allgemein' },
]

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

async function fetchFile(id: string): Promise<Blob> {
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

export async function uploadDocument(file: File, meta: { title: string; source: string; topic: TierDocument['topic'] }): Promise<void> {
  const params = new URLSearchParams({ filename: file.name, title: meta.title.trim() || file.name.replace(/\.[^.]+$/, '') })
  if (meta.source.trim()) params.set('source', meta.source.trim())
  if (meta.topic) params.set('topic', meta.topic)
  let res: Response
  try {
    res = await fetch(`${base}?${params}`, { method: 'POST', headers: { ...auth(), 'Content-Type': file.type || 'application/pdf' }, body: file })
  } catch {
    throw new Error('Hochladen braucht eine Verbindung zum Server.')
  }
  if (!res.ok) await failed(res, 'Hochladen fehlgeschlagen')
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${base}/${id}`, { method: 'DELETE', headers: auth() }).catch(() => null)
  if (!res) throw new Error('Löschen braucht eine Verbindung zum Server.')
  if (!res.ok) await failed(res, 'Löschen fehlgeschlagen')
}

export function fmtSize(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} kB`
}
