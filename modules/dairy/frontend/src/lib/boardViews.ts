// Gespeicherte Ansichten des Dashboards (schema/0036 board_views): alle Anzeige-Einstellungen der Karten (Kartenfelder,
// Spalten, Sortierung, Filtervorschläge, Summen, Einstellungen der Kartenwerte) als ein Paket. Die Einstellungen selbst
// bleiben im localStorage, wo die Seite sie liest; eine Ansicht ist eine Kopie dieser Schlüssel.
//
// Abgleich zwischen Geräten: Je Gerät ist gemerkt, welche Ansicht zuletzt geladen oder gespeichert wurde und mit welchem
// Stand (Signatur). Hat jemand die Ansicht seither auf einem anderen Gerät gespeichert und ist hier nichts ungespeichert
// geändert, übernimmt das Gerät den neuen Stand von selbst (viewSync).

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { forgetMilkFeedSettings } from './milkFeed'

/** Schlüssel nach «<moduleKey>_» (siehe Board.tsx, cardFields, columnLayout, columnTotals, meatValue, lambMilk, milkFeed, core/query) */
export const VIEW_KEYS = [
  'board_card_fields',
  'board_hidden_columns',
  'board_kinds',
  'board_column_order',
  'board_collapsed_columns',
  'board_totals',
  'board_presets',
  'board_sort',
  'board_sort_auto',
  'meat_settings',
  'lamb_milk',
  'milk_feed_settings',
] as const

export type ViewSettings = Partial<Record<(typeof VIEW_KEYS)[number], string>>

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const browser = (): Store | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Aktuelle Einstellungen dieses Geräts (nur gesetzte Schlüssel). */
export function captureView(moduleKey: string, store: Store | null = browser()): ViewSettings {
  const out: ViewSettings = {}
  if (!store) return out
  for (const k of VIEW_KEYS) {
    const v = store.getItem(`${moduleKey}_${k}`)
    if (v != null) out[k] = v
  }
  return out
}

/** Ansicht ins Gerät schreiben; was die Ansicht nicht enthält, fällt auf die Vorgabe zurück. */
export function applyView(moduleKey: string, settings: ViewSettings, store: Store | null = browser()): void {
  if (store)
    for (const k of VIEW_KEYS) {
      const v = settings[k]
      try {
        if (v == null) store.removeItem(`${moduleKey}_${k}`)
        else store.setItem(`${moduleKey}_${k}`, v)
      } catch {
        // voll oder gesperrt: gilt bis zum Neuladen nicht
      }
    }
  forgetMilkFeedSettings(moduleKey)
}

/** Vergleichbarer Text einer Ansicht (feste Reihenfolge der Schlüssel). */
export function viewSignature(settings: ViewSettings): string {
  return JSON.stringify(VIEW_KEYS.map((k) => settings[k] ?? null))
}

export function parseSettings(raw: unknown): ViewSettings {
  try {
    const d = JSON.parse(String(raw ?? '{}')) as Record<string, unknown>
    const out: ViewSettings = {}
    for (const k of VIEW_KEYS) if (typeof d[k] === 'string') out[k] = d[k] as string
    return out
  } catch {
    return {}
  }
}

export interface BoardView {
  id: string
  name: string
  owner: string
  shared: boolean
  settings: ViewSettings
  updated_at: string
  /** gelöscht: bleibt in der Liste, damit Geräte die gemerkte Ansicht vergessen (statt auf das Laden zu warten) */
  deleted: boolean
}

export async function loadBoardViews(pg: PGlite): Promise<BoardView[]> {
  const { rows } = await pg.query<Record<string, unknown>>('select id, name, owner, shared, settings, updated_at, deleted_at from board_views order by lower(name)')
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    owner: String(r.owner),
    shared: r.shared === true,
    settings: parseSettings(r.settings),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    deleted: r.deleted_at != null,
  }))
}

/** Eigene Ansichten (auch freigegebene) und die freigegebenen der anderen; private der anderen bleiben verborgen. */
export function visibleViews(views: BoardView[], me: string | null): { mine: BoardView[]; others: BoardView[] } {
  const same = (o: string) => !!me && o.toLowerCase() === me.toLowerCase()
  const live = views.filter((v) => !v.deleted)
  return { mine: live.filter((v) => same(v.owner)), others: live.filter((v) => !same(v.owner) && v.shared) }
}

export async function saveBoardView(pg: PGlite, v: { id?: string; name: string; owner: string; shared: boolean; settings: ViewSettings }): Promise<string> {
  const id = v.id ?? crypto.randomUUID()
  await upsertRow(pg, 'board_views', { id, name: v.name.trim(), owner: v.owner, shared: v.shared, settings: JSON.stringify(v.settings), created_by: v.owner, deleted_at: null })
  return id
}

export async function renameBoardView(pg: PGlite, id: string, patch: { name: string; shared: boolean }): Promise<void> {
  await upsertRow(pg, 'board_views', { id, name: patch.name.trim(), shared: patch.shared })
}

export const deleteBoardView = (pg: PGlite, id: string) => softDeleteRow(pg, 'board_views', id)

/** Je Gerät: zuletzt geladene/gespeicherte Ansicht und deren Stand. */
export interface CurrentView {
  id: string
  sig: string
}
const currentKey = (moduleKey: string) => `${moduleKey}_board_view`

export function readCurrent(moduleKey: string, store: Store | null = browser()): CurrentView | null {
  try {
    const v = JSON.parse(store?.getItem(currentKey(moduleKey)) ?? 'null') as CurrentView | null
    return v && typeof v.id === 'string' && typeof v.sig === 'string' ? v : null
  } catch {
    return null
  }
}

export function writeCurrent(moduleKey: string, v: CurrentView | null, store: Store | null = browser()): void {
  try {
    if (v) store?.setItem(currentKey(moduleKey), JSON.stringify(v))
    else store?.removeItem(currentKey(moduleKey))
  } catch {
    // nur bis zum Neuladen
  }
}

/**
 * Was mit der gemerkten Ansicht zu tun ist:
 * - `none`: keine gemerkt, oder die Zeile ist (noch) nicht da, z.B. gleich nach dem Speichern
 * - `gone`: gelöscht oder nicht mehr freigegeben → vergessen
 * - `same`: Gerät und Ansicht stimmen überein (evtl. Stand nachführen)
 * - `changed`: hier geändert, noch nicht gespeichert
 * - `adopt`: anderswo gespeichert, hier unverändert → neuen Stand übernehmen
 * - `conflict`: beides geändert → Person entscheidet
 */
export type SyncState = 'none' | 'gone' | 'same' | 'changed' | 'adopt' | 'conflict'

export function viewSync(current: CurrentView | null, view: BoardView | undefined, localSig: string, visible = true): SyncState {
  if (!current || !view) return 'none'
  if (view.deleted || !visible) return 'gone'
  const rowSig = viewSignature(view.settings)
  if (rowSig === localSig) return 'same'
  if (rowSig === current.sig) return 'changed'
  if (localSig === current.sig) return 'adopt'
  return 'conflict'
}
