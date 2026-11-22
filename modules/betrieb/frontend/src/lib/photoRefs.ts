// Fotos zu Arbeiten und Betriebsjournal (schema/0015_photos.sql): Angaben schreiben, Fotos je Eintrag lesen. Inhalt
// und Hochladen: core/frontend/src/photos.ts.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { queuePhoto, type PreparedPhoto } from '@fmis/core/photos'
import { upsertRow } from '../db/write'

export const PHOTO_MODULE = 'betrieb'
export type PhotoRefKind = 'work_task' | 'farm_journal'

/** Fotos zu einem Eintrag ablegen (Angaben per Sync, Inhalt im Hintergrund hochladen). */
export async function addPhotos(kind: PhotoRefKind, refId: string, photos: PreparedPhoto[]): Promise<void> {
  const now = new Date().toISOString()
  for (const p of photos) {
    const id = crypto.randomUUID()
    await queuePhoto(PHOTO_MODULE, id, p)
    await upsertRow('photos', {
      id,
      ref_kind: kind,
      ref_id: refId,
      taken_at: now,
      content_type: p.blob.type,
      size_bytes: p.blob.size,
      width: p.width,
      height: p.height,
      caption: null,
      created_by: getCurrentUserEmail(),
      archived_at: null,
      deleted_at: null,
    } as never)
  }
}

/** Foto-ids je Eintrag (nur die Angaben, nichts wird geladen). */
export async function photoIdsByRef(pg: PGlite, refIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!refIds.length) return out
  const { rows } = await pg.query<{ id: string; ref_id: string }>('select id, ref_id from photos where deleted_at is null and ref_id = any($1::uuid[]) order by taken_at', [refIds])
  for (const r of rows) out.set(r.ref_id, [...(out.get(r.ref_id) ?? []), r.id])
  return out
}
