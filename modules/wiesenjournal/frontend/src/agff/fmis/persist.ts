// FMIS: Speicher hinter dem AGFF-Store (agff/db/store.ts) ist pglite statt IndexedDB.
// Laden: alle Zeilen der Journal-Tabellen und die Herden aus dem Modul Tiere (abbildung.ts). Schreiben: über den
// gemeinsamen Schreibweg des FMIS (core/frontend/src/writer.ts), also mit Outbox, Sync, Verlauf und «Rückgängig».
// Ändern sich die Daten von aussen (Sync, andere FMIS-Seite, Rückgängig), lädt die Brücke neu und gibt dem Store
// nur, was neuer ist als sein Stand (Zeilen mit laufender Schreibung bleiben unberührt).

import type { PGlite } from '@electric-sql/pglite'
import type { Change, Persist, Row, Snapshot, Store, Table } from '../db/store'
import { emptySnapshot, SCHEMA } from '../db/store'
import { getDb as getWjDb } from '../../db/pglite'
import { subscribeDataChanged, writeBatch as wjBatch } from '../../db/write'
import { SYNC_TABLES as WJ_SPALTEN } from '../../db/tables'
import { getSyncedDb as getTiereDb } from '@fmis/tiere/db/access'
import { writeBatch as tiereBatch } from '@fmis/tiere/db/write'
import { compositionAt, journalCategory } from '@fmis/tiere/lib/herdModel'
import { localTodayIso } from '@fmis/core/dates'
import { errorText, notifyError } from '@fmis/core/toast'
import type { AnimalCategory } from '../types'
import {
  aufenthalteVonTiere,
  einstellungsId,
  einstellungVonFmis,
  herdenVonTiere,
  nachFmis,
  TIERE_KATEGORIE,
  vonFmis,
  WJ_TABELLEN,
  type TiereDaten,
  type WjTabelle,
} from './abbildung'

const GERAET_KEY = 'wiesenjournal_agff_geraet'
/** Herdengruppen, die es im Modul Tiere schon gibt (neue bekommen Tierart und Bestand) */
const geladeneHerden = new Set<string>()

// pglite liefert numeric als Text, date/timestamptz als Date
const NUMERIC = 1700
const DATE = 1082
const TIMESTAMPS = new Set([1114, 1184])

async function lesen(pg: PGlite, sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const r = await pg.query<Record<string, unknown>>(sql, params)
  const art = new Map(r.fields.map((f) => [f.name, f.dataTypeID]))
  return r.rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      const t = art.get(k)
      if (v == null) out[k] = null
      else if (t === NUMERIC) out[k] = Number(v)
      else if (t === DATE) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
      else if (t != null && TIMESTAMPS.has(t)) out[k] = v instanceof Date ? v.toISOString() : String(v)
      else out[k] = v
    }
    return out
  })
}

function geraetLesen(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(GERAET_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function geraetSchreiben(key: string, value: unknown) {
  try {
    const s = geraetLesen()
    if (value === undefined) delete s[key]
    else s[key] = value
    localStorage.setItem(GERAET_KEY, JSON.stringify(s))
  } catch {
    // Speicher voll oder gesperrt: nur Gerätewerte (Regen), die App holt sie wieder
  }
}

async function tiereLaden(): Promise<TiereDaten> {
  const pg = await getTiereDb()
  const [groups, stays, members, counts, locations] = await Promise.all([
    lesen(pg, 'select * from herd_groups where deleted_at is null'),
    lesen(pg, 'select * from herd_stays where deleted_at is null'),
    lesen(pg, 'select * from herd_members where deleted_at is null'),
    lesen(pg, 'select * from herd_counts where deleted_at is null'),
    lesen(pg, 'select id, laufhof from locations where deleted_at is null'),
  ])
  const heute = localTodayIso()
  const bestand = new Map<string, Map<AnimalCategory, number>>()
  for (const g of groups) {
    const c = compositionAt(String(g.id), members as never, counts as never, heute)
    const m = new Map<AnimalCategory, number>()
    for (const [k, v] of c.byCategory) {
      const j = journalCategory(k) as AnimalCategory
      m.set(j, (m.get(j) ?? 0) + v.identified + v.anonymous)
    }
    bestand.set(String(g.id), m)
  }
  return { groups: groups as never, stays: stays as never, locations: locations as never, bestand }
}

export async function snapshotLaden(): Promise<Snapshot> {
  const pg = await getWjDb()
  const snap = emptySnapshot()
  const s = snap as unknown as Record<string, Row[]>
  for (const t of WJ_TABELLEN) {
    const rows = await lesen(pg, `select * from "${t}"`)
    s[t] = rows.map((r) => vonFmis(t, r as never)).filter((r): r is NonNullable<typeof r> => r != null) as Row[]
  }
  // Anteile nur zu Gaben, die im Journal stehen (geplante Gaben bleiben draussen)
  const gaben = new Set(s.fertilization_entries.map((e) => e.id))
  s.fertilization_shares = s.fertilization_shares.filter((x) => gaben.has(String((x as Record<string, unknown>).entry_id)))
  s.einstellungen = (await lesen(pg, 'select * from journal_einstellungen')).map((r) => einstellungVonFmis(r as never)) as Row[]
  try {
    const tiere = await tiereLaden()
    s.herden = herdenVonTiere(tiere) as unknown as Row[]
    for (const g of tiere.groups) geladeneHerden.add(g.id)
    s.herden_aufenthalte = aufenthalteVonTiere(tiere) as unknown as Row[]
  } catch (e) {
    // ohne Recht auf die Tiere: Journal ohne Herden
    console.warn('Herden aus dem Modul Tiere nicht geladen', e)
  }
  snap.settings = { ...geraetLesen(), schema: SCHEMA }
  return snap
}

// ---------- Schreiben ----------

type Z = Record<string, unknown> & { id: string }
let warteschlange: Promise<void> = Promise.resolve()
const laufend = new Map<string, number>()
const schluessel = (table: string, id: string) => `${table}|${id}`

function markieren(changes: Change[], d: number) {
  for (const c of changes) {
    if (c.table === 'settings') continue
    const k = schluessel(c.table, c.row.id)
    const n = (laufend.get(k) ?? 0) + d
    if (n > 0) laufend.set(k, n)
    else laufend.delete(k)
  }
}

async function schreiben(changes: Change[], store: () => Store | null): Promise<void> {
  const wj: { table: string; row: Z; loeschen: boolean }[] = []
  const tiere: { table: string; row: Z; loeschen: boolean }[] = []
  for (const c of changes) {
    if (c.table === 'settings') {
      if (c.key !== 'schema') geraetSchreiben(c.key, c.value)
      continue
    }
    const r = c.row as Z
    const loeschen = !!r.deleted_at
    if ((WJ_TABELLEN as readonly string[]).includes(c.table)) {
      const t = c.table as WjTabelle
      wj.push({ table: t, row: nachFmis(t, r, WJ_SPALTEN[t] as readonly string[]), loeschen })
    } else if (c.table === 'einstellungen') {
      wj.push({
        table: 'journal_einstellungen',
        row: { id: await einstellungsId(r.id), schluessel: r.id, wert: r.wert === undefined ? null : JSON.stringify(r.wert), deleted_at: r.deleted_at ?? null },
        loeschen,
      })
    } else if (c.table === 'herden_aufenthalte') {
      // Nur Weide-Aufenthalte gehen zurück (Stall und Alp führt das Modul Tiere); ein neuer Stall-Aufenthalt
      // («einstallen») heisst im FMIS: die Weide endet – das hat umziehen() schon geschrieben.
      const vorher = c.row.id ? (store()?.rows('herden_aufenthalte', true).find((a) => a.id === r.id) as Z | undefined) : undefined
      const slot = (vorher?.fmis_slot ?? r.fmis_slot) as string | undefined
      if (r.ort !== 'weide' || (slot && slot !== 'weide')) continue
      tiere.push({
        table: 'herd_stays',
        row: { id: r.id, group_id: r.herde_id, slot: 'weide', location_id: null, parcel_id: r.parcel_id, day_only: !!r.tagweide, from_date: r.von, to_date: r.bis ?? null, deleted_at: r.deleted_at ?? null },
        loeschen,
      })
    } else if (c.table === 'herden') {
      const k = TIERE_KATEGORIE[r.kategorie as AnimalCategory]
      if (!k) continue
      // neu = noch nicht im Modul Tiere (beim letzten Laden nicht dabei)
      const neu = !geladeneHerden.has(r.id)
      if (neu) geladeneHerden.add(r.id)
      tiere.push({
        table: 'herd_groups',
        row: { id: r.id, name: r.name, active: r.aktiv !== false, sort_order: r.sort_order ?? 0, notes: r.notes ?? null, deleted_at: r.deleted_at ?? null, ...(neu ? { species: k.species, milking: false } : {}) },
        loeschen,
      })
      // neue Herde mit Anzahl: Bestand ohne Nummern ab heute
      if (neu && typeof r.anzahl === 'number' && r.anzahl > 0 && !loeschen)
        tiere.push({ table: 'herd_counts', row: { id: crypto.randomUUID(), group_id: r.id, category: k.category, count: r.anzahl, from_date: localTodayIso(), to_date: null, notes: null }, loeschen: false })
    }
    // trips: im FMIS sind Fahrten GPS-Spuren des Moduls Betrieb; nichts zu schreiben
  }
  if (wj.length)
    await wjBatch(async (w) => {
      for (const x of wj) await w.upsert(x.table as never, x.row as never, x.loeschen ? { action: 'delete' } : undefined)
    })
  if (tiere.length)
    await tiereBatch(async (w) => {
      for (const x of tiere) await w.upsert(x.table as never, x.row as never, x.loeschen ? { action: 'delete' } : undefined)
    })
}

// ---------- Persist ----------

let gebunden: Store | null = null

export function pglitePersist(): Persist {
  return {
    name: 'fmis-pglite',
    load: snapshotLaden,
    write(changes) {
      markieren(changes, 1)
      const p = warteschlange.then(() => schreiben(changes, () => gebunden)).catch((e: unknown) => {
        console.error('Journal: Speichern fehlgeschlagen', e)
        notifyError(`Speichern fehlgeschlagen: ${errorText(e)}`)
        throw e
      })
      warteschlange = p.catch(() => undefined)
      return p.finally(() => markieren(changes, -1))
    },
    async replace() {
      throw new Error('Im FMIS gibt es keine Sicherungsdatei des Journals; die Daten liegen auf dem Server.')
    },
  }
}

const gleich = (a: unknown, b: unknown) => JSON.stringify({ ...(a as object), updated_at: 0 }) === JSON.stringify({ ...(b as object), updated_at: 0 })

/** Nach Änderungen von aussen neu laden und dem Store geben, was sich geändert hat. */
export async function abgleichen(store: Store): Promise<void> {
  const snap = await snapshotLaden()
  const changes: Change[] = []
  const tabellen = Object.keys(snap).filter((t) => t !== 'settings') as Table[]
  for (const t of tabellen) {
    const neu = new Map(((snap as unknown as Record<string, Row[]>)[t] ?? []).map((r) => [r.id, r]))
    for (const alt of store.rows(t, true) as unknown as Row[]) {
      if (laufend.has(schluessel(t, alt.id))) continue
      const n = neu.get(alt.id)
      if (!n) {
        // nicht mehr da (abgeleitete Stall-Stücke, nie gespeicherte Zeilen): als gelöscht führen
        if (!alt.deleted_at) changes.push({ table: t, row: { ...alt, deleted_at: new Date().toISOString() } as Row })
        continue
      }
      neu.delete(alt.id)
      if (!gleich(alt, n) && String(n.updated_at ?? '') >= String(alt.updated_at ?? '')) changes.push({ table: t, row: n })
      else if (!gleich(alt, n) && (t === 'herden' || t === 'herden_aufenthalte')) changes.push({ table: t, row: n })
    }
    for (const n of neu.values()) if (!laufend.has(schluessel(t, n.id))) changes.push({ table: t, row: n })
  }
  if (changes.length) store.applyRemote(changes)
}

let abo: (() => void) | null = null

/** Store an die Brücke hängen: Änderungen von aussen übernehmen (Sync, andere Seiten, Rückgängig). */
export function binden(store: Store): void {
  gebunden = store
  abo?.()
  let timer: ReturnType<typeof setTimeout> | null = null
  let laeuft = false
  let nochmal = false
  const los = () => {
    if (laeuft) {
      nochmal = true
      return
    }
    laeuft = true
    abgleichen(store)
      .catch((e) => console.warn('Abgleich Journal', e))
      .finally(() => {
        laeuft = false
        if (nochmal) {
          nochmal = false
          los()
        }
      })
  }
  abo = subscribeDataChanged(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(los, 200)
  })
}
