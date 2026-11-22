// Fotos für alle Module (zuerst Arbeiten und Betriebsjournal): klein halten, im Hintergrund hochladen, nur bei
// Bedarf laden. Der Inhalt liegt auf dem Server als Datei (core/backend/fmis_core/photo_files.py); in der lokalen
// Datenbank stehen nur die Angaben (wenige Bytes je Foto).
//
// Gegen Ballast:
// - Aufnahme wird verkleinert (lange Seite 1600 px, WebP ~150–300 kB) plus Vorschau 320 px (~10–20 kB)
// - Inhalt nie in der lokalen Datenbank; bis zum Hochladen im Browser-Cache, danach dort gelöscht
// - Listen zeigen nur 📷 und die Anzahl; Vorschauen laden erst beim Aufklappen, das grosse Foto erst beim Antippen
// - angesehene Vorschauen bleiben in einem begrenzten Cache (MAX_THUMBS), grosse Fotos nur im Speicher der Seite

import { API_URL, getToken } from './auth'

export interface PreparedPhoto {
  blob: Blob
  thumb: Blob
  width: number
  height: number
  /** Vorschau im Formular (URL.createObjectURL) */
  preview: string
}

const MAX_SIDE = 1600
const THUMB_SIDE = 320
const QUALITY = 0.8
const THUMB_QUALITY = 0.7
const PENDING = 'fmis-photos-pending'
const THUMBS = 'fmis-photo-thumbs'
const MAX_THUMBS = 300
const QUEUE_KEY = 'fmis_photo_upload_queue'

/** Endpunkt eines Moduls, z.B. «betrieb» → /betrieb/photos/<id> */
export const photoUrl = (moduleKey: string, id: string, thumb = false) => `${API_URL}/${moduleKey}/photos/${id}${thumb ? '?thumb=1' : ''}`

async function encode(bitmap: ImageBitmap, side: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const as = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  let blob = await as('image/webp')
  // ältere Safari schreiben kein WebP: dann JPEG (der Server nimmt beides)
  if (!blob || blob.type !== 'image/webp') blob = await as('image/jpeg')
  if (!blob) throw new Error('Foto liess sich nicht verarbeiten.')
  return { blob, width: canvas.width, height: canvas.height }
}

/** Aufnahme verkleinern: Foto und Vorschau als WebP. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  try {
    const full = await encode(bitmap, MAX_SIDE, QUALITY)
    const thumb = await encode(bitmap, THUMB_SIDE, THUMB_QUALITY)
    return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height, preview: URL.createObjectURL(thumb.blob) }
  } finally {
    bitmap.close()
  }
}

interface QueueItem {
  moduleKey: string
  id: string
}
function readQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as QueueItem[]
  } catch {
    return []
  }
}
function writeQueue(q: QueueItem[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    // ohne localStorage: das Foto bleibt im Cache und geht beim nächsten Aufruf mit
  }
}

/** Foto zum Hochladen vormerken (Inhalt in den Cache des Geräts, sofort sichtbar, auch ohne Netz). */
export async function queuePhoto(moduleKey: string, id: string, p: PreparedPhoto): Promise<void> {
  const cache = await caches.open(PENDING)
  await cache.put(photoUrl(moduleKey, id), new Response(p.blob, { headers: { 'Content-Type': p.blob.type } }))
  await cache.put(photoUrl(moduleKey, id, true), new Response(p.thumb, { headers: { 'Content-Type': p.thumb.type } }))
  writeQueue([...readQueue(), { moduleKey, id }])
  void uploadPendingPhotos()
}

let running: Promise<number> | null = null

/** Warteschlange hochladen (im Hintergrund, bei Netz); gibt die Zahl noch wartender Fotos zurück. */
export function uploadPendingPhotos(): Promise<number> {
  running ??= (async () => {
    try {
      if (typeof caches === 'undefined') return readQueue().length
      const cache = await caches.open(PENDING)
      for (const item of readQueue()) {
        let done = true
        for (const thumb of [true, false]) {
          const url = photoUrl(item.moduleKey, item.id, thumb)
          const res = await cache.match(url)
          if (!res) continue
          const blob = await res.blob()
          try {
            const put = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': blob.type }, body: blob })
            // Fehler im Foto selbst: aufgeben; sonst (kein Recht, Server alt, Störung) später nochmals
            if (put.ok || put.status === 400 || put.status === 413 || put.status === 415) {
              // die Vorschau bleibt als angesehene Vorschau, das grosse Foto verlässt das Gerät
              if (thumb) await keepThumb(url, blob)
              await cache.delete(url)
            } else done = false
          } catch {
            return readQueue().length // kein Netz
          }
        }
        if (done) writeQueue(readQueue().filter((q) => q.id !== item.id))
      }
      return readQueue().length
    } finally {
      running = null
    }
  })()
  return running
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void uploadPendingPhotos())
  // beim Start einmal nachholen, was offline liegen blieb
  setTimeout(() => void uploadPendingPhotos(), 5000)
}

export const pendingPhotoCount = () => readQueue().length

/** Angesehene Vorschau behalten, ältere fallen raus (höchstens MAX_THUMBS). */
async function keepThumb(url: string, blob: Blob): Promise<void> {
  try {
    const cache = await caches.open(THUMBS)
    await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }))
    const keys = await cache.keys()
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_THUMBS))) await cache.delete(k)
  } catch {
    // ohne Cache: nächstes Mal wieder vom Server
  }
}

const urls = new Map<string, Promise<string>>()

/** Foto oder Vorschau als Object-URL: zuerst vom Gerät (noch nicht hochgeladen, angesehene Vorschau), sonst vom
 * Server. Grosse Fotos werden nicht dauerhaft gespeichert. */
export function photoObjectUrl(moduleKey: string, id: string, thumb = false): Promise<string> {
  const url = photoUrl(moduleKey, id, thumb)
  let p = urls.get(url)
  if (!p) {
    p = (async () => {
      if (typeof caches !== 'undefined') {
        for (const name of [PENDING, THUMBS]) {
          const hit = await (await caches.open(name).catch(() => null))?.match(url)
          if (hit) return URL.createObjectURL(await hit.blob())
        }
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error(res.status === 404 ? 'noch nicht hochgeladen' : res.status === 410 ? 'archiviert' : `nicht verfügbar (${res.status})`)
      const blob = await res.blob()
      if (thumb) void keepThumb(url, blob)
      return URL.createObjectURL(blob)
    })()
    p.catch(() => urls.delete(url))
    urls.set(url, p)
  }
  return p
}
