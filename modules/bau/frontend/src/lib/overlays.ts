// Grundlagen der Karte (schema/0003_overlays.sql), z.B. Ebenen eines Leitungskataster-Auszugs:
// Angaben synchronisiert, Bild bei Bedarf vom Server (backend/app/overlays.py), danach im
// Browser-Cache, damit die Karte auch ohne Netz die Leitungen zeigt.

import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken } from '@fmis/core/auth'
import { softDeleteRow } from '../db/write'
import { syncClient } from '../db/sync'
import { num } from './format'
import type { BauOverlay } from '../types'

export async function loadOverlays(pg: PGlite): Promise<BauOverlay[]> {
  const { rows } = await pg.query<BauOverlay>('select * from overlays where deleted_at is null order by group_name, group_id, sort_order')
  return rows.map((r) => ({
    ...r,
    south: Number(r.south),
    west: Number(r.west),
    north: Number(r.north),
    east: Number(r.east),
    opacity: Number(r.opacity),
    sort_order: Number(r.sort_order),
    size_bytes: num(r.size_bytes),
  }))
}

/** Ebenen je Grundlage (in der Reihenfolge des Hochladens). */
export function groupOverlays(list: BauOverlay[]): { id: string; name: string; source: string | null; layers: BauOverlay[] }[] {
  const out: { id: string; name: string; source: string | null; layers: BauOverlay[] }[] = []
  for (const o of list) {
    const g = out.find((x) => x.id === o.group_id)
    if (g) g.layers.push(o)
    else out.push({ id: o.group_id, name: o.group_name, source: o.source, layers: [o] })
  }
  return out
}

const imageUrl = (id: string) => `${API_URL}/bau/sync/overlays/${id}`
const CACHE = 'fmis-bau-overlays'
const objectUrls = new Map<string, Promise<string>>()

/** Bild als Object-URL für die Karte. `bold`: Linien verbreitert für die Übersicht — beim
 * Verkleinern mittelt der Browser die feinen Linien sonst fast weg. */
export function overlayUrl(id: string, bold = false): Promise<string> {
  const key = bold ? `${id}:bold` : id
  let p = objectUrls.get(key)
  if (!p) {
    p = fetchImage(id)
      .then((blob) => (bold ? thicken(blob) : blob))
      .then((blob) => URL.createObjectURL(blob))
    p.catch(() => objectUrls.delete(key))
    objectUrls.set(key, p)
  }
  return p
}

/** Linien um ~3 Bildpunkte (rund 0.4 m) verbreitern: das Bild kreisförmig versetzt übereinander zeichnen. */
async function thicken(blob: Blob, r = 3): Promise<Blob> {
  const img = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return blob
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r) ctx.drawImage(img, dx, dy)
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return out ?? blob
}

async function fetchImage(id: string): Promise<Blob> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null
  const cached = await cache?.match(imageUrl(id))
  if (cached) return cached.blob()
  const res = await fetch(imageUrl(id), { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(`Grundlage nicht verfügbar (${res.status})`)
  await cache?.put(imageUrl(id), res.clone()).catch(() => undefined)
  return res.blob()
}

/** ZIP aus tools/leitungskataster_pdf.py hochladen; braucht Internet, die Ebenen kommen mit dem Sync. */
export async function uploadOverlayZip(file: File): Promise<number> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/bau/sync/overlays`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/zip' },
      body: file,
    })
  } catch {
    throw new Error('Hochladen braucht eine Verbindung zum Server.')
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail
    throw new Error(detail ?? `Hochladen fehlgeschlagen (${res.status})`)
  }
  const { layers } = (await res.json()) as { layers: number }
  await syncClient.syncNow()
  return layers
}

/** Ganze Grundlage entfernen (alle Ebenen; im Verlauf nachvollziehbar). */
export async function removeOverlayGroup(layers: BauOverlay[]): Promise<void> {
  for (const o of layers) await softDeleteRow('overlays', o.id)
}
