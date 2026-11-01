// Fotos zu Journal-Einträgen (schema/0023, backend/app/photos.py).
//
// Ablauf: Foto wählen/aufnehmen → verkleinern und als WebP speichern
// (toWebp) → beim Speichern des Eintrags (savePhotos) kommt der Inhalt in den
// Browser-Cache (sofort sichtbar, auch ohne Netz), die Angaben als
// journal_photos-Zeile in die Datenbank und die id in die Warteschlange.
// uploadPendingPhotos() lädt die Warteschlange hoch, sobald Verbindung da
// ist; der Server nimmt jede id nur einmal an, Wiederholen schadet nicht.

import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getCurrentUserEmail, getToken } from '@fmis/core/auth'
import { upsertRow } from '../db/write'

export interface PreparedPhoto {
  blob: Blob
  width: number
  height: number
  /** Vorschau im Formular (URL.createObjectURL) */
  preview: string
}

export interface JournalPhoto {
  id: string
  animal_id: string
  journal_id: string | null
  case_id: string | null
  taken_at: string
  content_type: string
  caption: string | null
}

/** Lange Seite höchstens so viele Pixel — reicht für Befunde, ~150–400 kB als WebP. */
const MAX_SIDE = 1600
const QUALITY = 0.8
const CACHE = 'fmis-journal-photos'
const QUEUE_KEY = 'fmis_photo_queue'

const photoUrl = (moduleKey: string, id: string) => `${API_URL}/${moduleKey}/photos/${id}`

/** Foto verkleinern und als WebP kodieren. Kann der Browser kein WebP
 * schreiben (ältere Safari), wird es JPEG — der Server nimmt beides. */
export async function toWebp(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
  let blob = await encode('image/webp')
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg')
  if (!blob) throw new Error('Foto liess sich nicht verarbeiten.')
  return { blob, width: canvas.width, height: canvas.height, preview: URL.createObjectURL(blob) }
}

function readQueue(): { moduleKey: string; id: string }[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as { moduleKey: string; id: string }[]
  } catch {
    return []
  }
}
function writeQueue(q: { moduleKey: string; id: string }[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    // ohne localStorage bleibt das Foto im Cache und kommt beim nächsten Speichern mit
  }
}

/** Fotos eines eben gespeicherten Eintrags ablegen (je Foto eine Zeile). */
export async function savePhotos(
  pg: PGlite,
  moduleKey: string,
  photos: PreparedPhoto[],
  target: { animalId: string; journalId: string | null; caseId: string | null },
): Promise<void> {
  if (!photos.length) return
  const cache = await caches.open(CACHE)
  const queue = readQueue()
  const now = new Date().toISOString()
  for (const p of photos) {
    const id = crypto.randomUUID()
    await cache.put(photoUrl(moduleKey, id), new Response(p.blob, { headers: { 'Content-Type': p.blob.type } }))
    queue.push({ moduleKey, id })
    await upsertRow(pg, 'journal_photos', {
      id,
      animal_id: target.animalId,
      journal_id: target.journalId,
      case_id: target.caseId,
      taken_at: now,
      content_type: p.blob.type,
      size_bytes: p.blob.size,
      width: p.width,
      height: p.height,
      caption: null,
      created_by: getCurrentUserEmail(),
      deleted_at: null,
    })
  }
  writeQueue(queue)
  void uploadPendingPhotos()
}

let uploading: Promise<number> | null = null

/** Warteschlange hochladen; gibt die Zahl noch wartender Fotos zurück. */
export function uploadPendingPhotos(): Promise<number> {
  uploading ??= (async () => {
    try {
      const cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null
      for (const item of readQueue()) {
        const res = await cache?.match(photoUrl(item.moduleKey, item.id))
        if (!res) {
          // Inhalt fehlt (Cache geleert): nichts mehr hochzuladen
          writeQueue(readQueue().filter((q) => q.id !== item.id))
          continue
        }
        const blob = await res.blob()
        try {
          const put = await fetch(photoUrl(item.moduleKey, item.id), {
            method: 'PUT',
            headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': blob.type },
            body: blob,
          })
          // Nur bei einem Fehler im Foto selbst aufgeben (leer, zu gross, falscher Typ) — alles
          // andere (kein Recht, Server noch nicht aktualisiert, Störung) später nochmals versuchen
          if (put.ok || put.status === 400 || put.status === 413 || put.status === 415) {
            writeQueue(readQueue().filter((q) => q.id !== item.id))
          }
        } catch {
          break // kein Netz — später wieder
        }
      }
      return readQueue().length
    } finally {
      uploading = null
    }
  })()
  return uploading
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void uploadPendingPhotos())

/** Anzahl Fotos, die noch auf dem Gerät warten. */
export const pendingPhotoCount = () => readQueue().length

const objectUrls = new Map<string, Promise<string>>()

/** Foto als Object-URL: zuerst aus dem Cache des Geräts, sonst vom Server. */
export function photoObjectUrl(moduleKey: string, id: string): Promise<string> {
  let p = objectUrls.get(id)
  if (!p) {
    p = (async () => {
      const url = photoUrl(moduleKey, id)
      const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null
      const hit = await cache?.match(url)
      if (hit) return URL.createObjectURL(await hit.blob())
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error(res.status === 404 ? 'Foto noch nicht hochgeladen' : `Foto nicht verfügbar (${res.status})`)
      await cache?.put(url, res.clone()).catch(() => undefined)
      return URL.createObjectURL(await res.blob())
    })()
    p.catch(() => objectUrls.delete(id))
    objectUrls.set(id, p)
  }
  return p
}

export async function loadPhotos(pg: PGlite, animalId: string): Promise<JournalPhoto[]> {
  const { rows } = await pg.query<JournalPhoto>(
    `select p.id, p.animal_id, p.journal_id, p.case_id, p.taken_at, p.content_type, p.caption
     from journal_photos p
     left join animal_journal j on j.id = p.journal_id
     where p.animal_id = $1 and p.deleted_at is null and (p.journal_id is null or j.deleted_at is null)
     order by p.taken_at`,
    [animalId],
  )
  return rows.map((r) => ({ ...r, taken_at: String(r.taken_at) }))
}
