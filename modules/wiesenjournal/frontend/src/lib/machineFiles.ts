// Bilder und Anleitungen je Maschine (schema/0016_machine_details.sql): die
// Angaben werden synchronisiert, der Inhalt kommt bei Bedarf vom Server
// (backend/app/machine_files.py) und bleibt danach im Browser-Cache.

import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken } from '@fmis/core/auth'
import { num } from './format'
import { syncClient } from '../db/sync'
import type { MachineFile, MachineFileKind } from '../types'

export async function loadMachineFiles(pg: PGlite, machineId?: string): Promise<MachineFile[]> {
  const { rows } = await pg.query<MachineFile>(
    `select * from machine_files where deleted_at is null ${machineId ? 'and machine_id = $1' : ''} order by sort_order, filename`,
    machineId ? [machineId] : [],
  )
  return rows.map((r) => ({ ...r, size_bytes: num(r.size_bytes) }))
}

export const MACHINE_FILE_KIND_LABEL: Record<MachineFileKind, string> = {
  bild: 'Bild',
  anleitung: 'Anleitung',
  dokument: 'Dokument',
}

const fileUrl = (id: string) => `${API_URL}/wiesenjournal/files/${id}`
const CACHE = 'fmis-machine-files'
const objectUrls = new Map<string, Promise<string>>()

/** Datei als Object-URL (für <img> bzw. zum Öffnen). Geladene Dateien kommen
 * in den Browser-Cache, damit Bilder und Anleitungen auch ohne Netz gehen. */
export function machineFileUrl(id: string): Promise<string> {
  let p = objectUrls.get(id)
  if (!p) {
    p = fetchFile(id).then((blob) => URL.createObjectURL(blob))
    p.catch(() => objectUrls.delete(id))
    objectUrls.set(id, p)
  }
  return p
}

async function fetchFile(id: string): Promise<Blob> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null
  const cached = await cache?.match(fileUrl(id))
  if (cached) return cached.blob()
  const res = await fetch(fileUrl(id), { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(`Datei nicht verfügbar (${res.status})`)
  await cache?.put(fileUrl(id), res.clone()).catch(() => undefined)
  return res.blob()
}

/** Grosse Fotos vor dem Hochladen verkleinern (lange Seite max. 2000 px). */
async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 800_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/** Hochladen braucht Internet; die neue Zeile kommt mit dem Sync zurück. */
export async function uploadMachineFile(machineId: string, file: File, kind: MachineFileKind, title?: string): Promise<void> {
  const body = await shrinkImage(file)
  const filename = body === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg'
  const params = new URLSearchParams({ filename, kind })
  if (title?.trim()) params.set('title', title.trim())
  let res: Response
  try {
    res = await fetch(`${API_URL}/wiesenjournal/files/machines/${machineId}?${params}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': body.type || file.type },
      body,
    })
  } catch {
    throw new Error('Hochladen braucht eine Verbindung zum Server.')
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail
    throw new Error(detail ?? `Hochladen fehlgeschlagen (${res.status})`)
  }
  await syncClient.syncNow()
}

export function fmtBytes(n: number | null): string {
  if (n == null) return ''
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} kB`
}
