// Lokale Datenhaltung (seit Etappe 1c, ersetzt pglite): alle Zeilen liegen im Arbeitsspeicher, IndexedDB ist nur der
// dauerhafte Speicher dahinter. Lesen ist synchron und sofort; jede Schreibung ändert zuerst den Speicher (Anzeige sofort
// aktuell) und wird gleich danach in IndexedDB geschrieben. Ein Betrieb hat wenige tausend Zeilen, das passt locker.
//
// Löschen ist weich (deleted_at), wie bisher: Einträge bleiben in der Sicherung nachvollziehbar.

import type {
  AuslaufAusnahme,
  Herde,
  HerdenAufenthalt,
  DailyFarmLog,
  Einstellung,
  FertilizationEntry,
  FertilizationShare,
  FertilizerType,
  Parcel,
  Trip,
  UsageEntry,
  WeedObservation,
} from '../types'
import { DEFAULTS, SEED_FERTILIZER_TYPES } from './seed'

export interface TableTypes {
  parcels: Parcel
  usage_entries: UsageEntry
  fertilizer_types: FertilizerType
  fertilization_entries: FertilizationEntry
  fertilization_shares: FertilizationShare
  daily_farm_log: DailyFarmLog
  weed_observations: WeedObservation
  trips: Trip
  auslauf_ausnahmen: AuslaufAusnahme
  herden: Herde
  herden_aufenthalte: HerdenAufenthalt
  einstellungen: Einstellung
}
export type Table = keyof TableTypes
export const TABLES: Table[] = [
  'parcels',
  'usage_entries',
  'fertilizer_types',
  'fertilization_entries',
  'fertilization_shares',
  'daily_farm_log',
  'weed_observations',
  'trips',
  'auslauf_ausnahmen',
  'herden',
  'herden_aufenthalte',
  'einstellungen',
]

/**
 * Einstellungen, die auf dem Gerät bleiben (in `settings`, ohne Zeitstempel, nie in der Cloud). Alle anderen Schlüssel sind
 * Betriebseinstellungen und liegen in der Tabelle «einstellungen» (Entscheid des Betriebs 16.11.2026: mit der Cloud abgleichen).
 * «regen»: von graswachstum.ch geholte Regenmengen (lib/regen.ts), jedes Gerät holt sie selbst.
 */
export const GERAET_EINSTELLUNGEN = new Set(['schema', 'angelegt', 'regen'])

export type Snapshot = { [K in Table]: TableTypes[K][] } & { settings: Record<string, unknown> }
export type Change = ({ table: Table; row: { id: string } } | { table: 'settings'; key: string; value: unknown }) & {
  /** aus der Cloud übernommen (nicht wieder hochladen) */
  extern?: boolean
}

/** Dauerhafter Speicher hinter dem Store (IndexedDB im Browser, Speicher in Tests). */
export interface Persist {
  readonly name: string
  load(): Promise<Snapshot | null>
  write(changes: Change[]): Promise<void>
  replace(snapshot: Snapshot): Promise<void>
}

export function emptySnapshot(): Snapshot {
  const s = { settings: {} } as Snapshot
  for (const t of TABLES) (s as Record<string, unknown>)[t] = []
  return s
}

export type Row = { id: string; deleted_at?: string | null; updated_at?: string }

/** aktueller Schema-Stand der Daten */
export const SCHEMA = 4

/** Schritt n → n+1. Bestehende Zeilen werden ohne neuen Zeitstempel umgeschrieben (kein «geändert» für die Sicherung). */
const SCHRITTE: Record<number, (s: Store) => void> = {
  // 1 → 2: Laufhof war ein Häkchen «Laufhof / Auslauf» (boolean). Das Häkchen wurde von Hand gesetzt und hiess Laufhof,
  // darum wird true zu «L»; die Weide steht ohnehin je Parzelle im Journal und ergibt «X» automatisch. Kein Häkchen hiess
  // «nicht erfasst», nicht «kein Auslauf», darum wird es «auto» (null), nicht «0».
  1: (s) => {
    for (const r of s.rows('daily_farm_log', true)) {
      const neu: Record<string, unknown> = {}
      for (const k of Object.keys(r)) {
        if (!k.startsWith('laufhof_')) continue
        const v = (r as unknown as Record<string, unknown>)[k]
        if (typeof v === 'boolean' || v == null) neu[k] = v === true ? 'L' : null
      }
      s.ersetzen('daily_farm_log', { ...r, ...neu })
    }
  },
  // 2 → 3: Parzellen bekommen «favorit» (Stern im Finder, Entscheid E3). Die Vorgabe false kommt beim Laden aus DEFAULTS;
  // bestehende Zeilen werden darum nicht umgeschrieben (kein Hochladen aller Parzellen in die Cloud, Sicherungen älterer
  // Versionen bleiben gültig). Der Schritt hält nur den Stand fest.
  2: () => {},
  // 3 → 4: Betriebseinstellungen (Betriebsnummer, kleine Parzellen, Schnellerfassung, Zählung, Quellenangaben) ziehen von
  // `settings` in die Tabelle «einstellungen», damit sie einen Zeitstempel haben und mit der Cloud abgeglichen werden. Der
  // Zeitstempel ist der älteste mögliche: ein umgezogener Wert ist «unbekannt alt» und weicht jeder bewussten Änderung auf
  // einem anderen Gerät (sonst überschriebe ein später aktualisiertes Gerät die neuere Einstellung mit seiner alten).
  3: (s) => s.einstellungenUmziehen(),
}

const UMGEZOGEN = '1970-01-01T00:00:00.000Z'

export class Store {
  private data = new Map<Table, Map<string, Row>>()
  private settings = new Map<string, unknown>()
  private listeners = new Set<() => void>()
  private batchDepth = 0
  private queued: Change[] = []
  private writing: Promise<void> = Promise.resolve()
  version = 0
  lastError: string | null = null
  loadMs = 0
  onChanges: ((changes: Change[]) => void) | null = null
  private changeHoerer = new Set<(changes: Change[]) => void>()

  private constructor(readonly persist: Persist) {
    for (const t of TABLES) this.data.set(t, new Map())
  }

  static async open(persist: Persist): Promise<Store> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const s = new Store(persist)
    const snap = await persist.load()
    if (snap) {
      s.fill(snap)
      s.migrieren()
    } else {
      // erster Start: Düngerarten mit Richtwerten
      s.batch(() => {
        for (const ft of SEED_FERTILIZER_TYPES) s.put('fertilizer_types', ft)
        s.setSetting('schema', SCHEMA)
        s.setSetting('angelegt', new Date(Date.now() + 2000).toISOString())
      })
      await s.flush()
    }
    s.loadMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0)
    return s
  }

  private fill(snap: Snapshot) {
    for (const t of TABLES) {
      const m = new Map<string, Row>()
      for (const r of (snap[t] ?? []) as Row[]) m.set(r.id, { ...DEFAULTS[t], ...r } as Row)
      this.data.set(t, m)
    }
    this.settings = new Map(Object.entries(snap.settings ?? {}))
  }

  // ---------- Lesen ----------

  /** Alle nicht gelöschten Zeilen einer Tabelle (Kopie der Liste, Zeilen nicht verändern). */
  rows<K extends Table>(table: K, withDeleted = false): TableTypes[K][] {
    const out: TableTypes[K][] = []
    for (const r of this.data.get(table)!.values()) if (withDeleted || !r.deleted_at) out.push(r as unknown as TableTypes[K])
    return out
  }

  get<K extends Table>(table: K, id: string | null | undefined): TableTypes[K] | null {
    if (!id) return null
    const r = this.data.get(table)!.get(id)
    return r && !r.deleted_at ? (r as unknown as TableTypes[K]) : null
  }

  count(table: Table): { total: number; deleted: number } {
    let deleted = 0
    const m = this.data.get(table)!
    for (const r of m.values()) if (r.deleted_at) deleted++
    return { total: m.size, deleted }
  }

  getSetting<T>(key: string, fallback: T): T {
    let v: unknown
    if (GERAET_EINSTELLUNGEN.has(key)) v = this.settings.get(key)
    else {
      const r = this.data.get('einstellungen')!.get(key)
      v = r && !r.deleted_at ? (r as unknown as Einstellung).wert : this.settings.get(key) // settings: noch nicht umgezogen
    }
    if (v === undefined || v === null) return fallback
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) return { ...fallback, ...(v as object) } as T
    return v as T
  }

  // ---------- Schreiben ----------

  /** Einfügen oder ändern: vorhandene Felder bleiben, übergebene ersetzen sie (wie «upsert»). */
  put<K extends Table>(table: K, row: Partial<TableTypes[K]> & { id: string }): TableTypes[K] {
    const m = this.data.get(table)!
    const prev = m.get(row.id)
    const next = { ...DEFAULTS[table], ...(prev ?? {}), ...row, updated_at: new Date().toISOString() } as Row
    if (!('deleted_at' in row)) next.deleted_at = null
    for (const k of Object.keys(next)) if ((next as Record<string, unknown>)[k] === undefined) (next as Record<string, unknown>)[k] = null
    m.set(row.id, next)
    this.changed({ table, row: next })
    return next as unknown as TableTypes[K]
  }

  /** Zeile unverändert übernehmen (für Schema-Schritte): kein neuer Zeitstempel, aber gespeichert. */
  ersetzen<K extends Table>(table: K, row: TableTypes[K]): void {
    const r = row as unknown as Row
    this.data.get(table)!.set(r.id, r)
    this.changed({ table, row: r })
  }

  softDelete(table: Table, id: string): void {
    const r = this.data.get(table)!.get(id)
    if (!r || r.deleted_at) return
    const now = new Date().toISOString()
    const next = { ...r, deleted_at: now, updated_at: now }
    this.data.get(table)!.set(id, next)
    this.changed({ table, row: next })
  }

  /** Gerätebezogenes in `settings`, alles andere als Zeile in «einstellungen» (mit Zeitstempel, für die Cloud). */
  setSetting(key: string, value: unknown): void {
    if (GERAET_EINSTELLUNGEN.has(key)) {
      this.settings.set(key, value)
      this.changed({ table: 'settings', key, value })
    } else this.put('einstellungen', { id: key, wert: value ?? null })
  }

  /** Schema-Schritt 3 → 4 (auch für zurückgespielte ältere Sicherungen): Betriebseinstellungen in die Tabelle. */
  einstellungenUmziehen(): void {
    const m = this.data.get('einstellungen')!
    for (const [key, value] of [...this.settings]) {
      if (GERAET_EINSTELLUNGEN.has(key)) continue
      if (!m.has(key) && value !== undefined) this.ersetzen('einstellungen', { id: key, wert: value, updated_at: UMGEZOGEN, deleted_at: null })
      this.settings.delete(key)
      this.changed({ table: 'settings', key, value: undefined })
    }
  }

  /** Mehrere Schreibungen: eine Benachrichtigung, eine IndexedDB-Transaktion. */
  batch<T>(fn: () => T): T {
    this.batchDepth++
    try {
      return fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0) this.commit()
    }
  }

  private changed(c: Change) {
    this.queued.push(c)
    if (this.batchDepth === 0) this.commit()
  }

  private commit() {
    if (!this.queued.length) return
    const changes = this.queued
    this.queued = []
    this.version++
    // sofort schreiben, nicht hinter der vorherigen Schreibung anstellen (Reihenfolge hält IndexedDB selbst ein)
    const geschrieben = this.persist
      .write(changes)
      .then(
        () => {
          if (this.lastError) {
            this.lastError = null
            this.emit()
          }
        },
        (err: unknown) => {
          this.lastError = `Speichern auf dem Gerät fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`
          this.emit()
        },
      )
    this.writing = Promise.all([this.writing, geschrieben]).then(() => undefined)
    this.onChanges?.(changes)
    this.changeHoerer.forEach((h) => h(changes))
    this.emit()
  }

  /** Jede gespeicherte Änderung beobachten (z.B. für den Cloud-Abgleich). */
  aenderungenAbonnieren(h: (changes: Change[]) => void): () => void {
    this.changeHoerer.add(h)
    return () => this.changeHoerer.delete(h)
  }

  /** Zeilen von aussen (Cloud) übernehmen: unverändert (kein neuer Zeitstempel), gespeichert, als «extern» gemeldet. */
  uebernehmen(zeilen: { table: Table; row: Row }[]): void {
    if (!zeilen.length) return
    this.batch(() => {
      for (const { table, row } of zeilen) {
        const r = { ...DEFAULTS[table], ...row } as Row
        this.data.get(table)!.set(r.id, r)
        this.queued.push({ table, row: r, extern: true })
      }
    })
  }

  /** Wartet, bis alle Schreibungen in IndexedDB sind. */
  async flush(): Promise<void> {
    this.commit()
    await this.writing
  }

  /** Änderungen aus einem anderen Tab übernehmen (ohne erneut zu speichern). */
  applyRemote(changes: Change[]): void {
    for (const c of changes) {
      if (c.table === 'settings') {
        if (c.value === undefined) this.settings.delete(c.key)
        else this.settings.set(c.key, c.value)
      } else this.data.get(c.table)!.set(c.row.id, c.row as Row)
    }
    this.version++
    this.emit()
  }

  // ---------- Ganzer Bestand (Sicherung) ----------

  snapshot(): Snapshot {
    const s = emptySnapshot()
    for (const t of TABLES) (s as Record<string, unknown>)[t] = [...this.data.get(t)!.values()]
    s.settings = Object.fromEntries(this.settings)
    return s
  }

  async replaceAll(snap: Snapshot): Promise<void> {
    await this.flush()
    await this.persist.replace(snap)
    this.fill(snap)
    this.migrieren()
    this.version++
    this.emit()
  }

  /** Datenumbauten je Schema-Stand (Einstellung «schema»); auch für zurückgespielte ältere Sicherungen. */
  migrieren(): void {
    let stand = Number(this.getSetting('schema', 1)) || 1
    if (stand >= SCHEMA) return
    this.batch(() => {
      while (stand < SCHEMA) {
        SCHRITTE[stand]?.(this)
        stand++
      }
      this.setSetting('schema', stand)
    })
  }

  // ---------- Benachrichtigung ----------

  subscribe(l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}

/** Speicher ohne Dauerhaftigkeit (Tests). */
export function memoryPersist(initial: Snapshot | null = null): Persist {
  let snap = initial
  return {
    name: 'speicher',
    async load() {
      return snap ? structuredClone(snap) : null
    },
    async write(changes) {
      snap ??= emptySnapshot()
      for (const c of changes) {
        if (c.table === 'settings') {
          if (c.value === undefined) delete snap.settings[c.key]
          else snap.settings[c.key] = c.value
        }
        else {
          const list = snap[c.table] as Row[]
          const i = list.findIndex((r) => r.id === c.row.id)
          if (i >= 0) list[i] = structuredClone(c.row) as Row
          else list.push(structuredClone(c.row) as Row)
        }
      }
    },
    async replace(s) {
      snap = structuredClone(s)
    },
  }
}
