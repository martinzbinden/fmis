// Tiere modulübergreifend: Herdengruppen und Standorte (Wiesenjournal →
// Herden) verknüpfen Einzeltiere aus den Tiermodulen (Milchschafe,
// Milchkühe, Mastplaner), ohne deren Daten zu kopieren. Jedes Tiermodul
// stellt dafür einen AnimalProvider bereit (ModuleDescriptor.animals); die
// Shell registriert die aktivierten beim Start (frontend/src/App.tsx).

import { syncModuleNow } from './sync'

export type HerdSpecies = 'schafe' | 'rinder'

export interface AnimalRef {
  moduleKey: string
  id: string
  ear_tag: string
  lauf_nr: string | null
  name: string | null
  /** "2212 · 9000.0080" — Laufnummer und kurze Ohrmarke */
  label: string
  sex: 'w' | 'm' | 'k' | null
  birth_date: string | null
  species: HerdSpecies
  /** Anzahl Laktationen bzw. Geburten (0 = noch nie geboren); null = unbekannt */
  parity: number | null
  /** trockengestellt (nur Milchmodule) */
  dry?: boolean
  /** Mastlamm, Mastrind */
  fattening?: boolean
}

/** Stand eines Tiers für das Lesegerät (Listen zum Anzeigen nach dem Lesen). */
export interface ReaderFacts {
  /** letzte Geburt (Ablammung/Abkalbung), ISO-Datum */
  lastBirth: string | null
  /** Ergebnis der letzten Untersuchung seit dieser Geburt */
  pregnancy: { date: string; result: 'ja' | 'nein' | 'unsicher' } | null
}

export interface AnimalProvider {
  title: string
  species: HerdSpecies
  /** Aktive Tiere des Moduls (lokale Datenbank). */
  listAnimals(): Promise<AnimalRef[]>
  /** Letzte Geburt und Untersuchung je Tier-ID (Milchmodule), für die Listen fürs Lesegerät. */
  readerFacts?(): Promise<Map<string, ReaderFacts>>
  /** Trockenstellen ab Datum (Milchmodule). */
  dryOff?(animalIds: string[], date: string, note: string): Promise<void>
  /** Offene Merklisten mit ihren Tieren (z.B. um sie einer Tiergruppe zuzuteilen). */
  listWatchlists?(): Promise<{ id: string; name: string; animalIds: string[] }[]>
}

/** Merklisten aller Tiermodule einer Tierart (Name mit Modul, falls mehrere). */
export async function listAllWatchlists(species?: HerdSpecies): Promise<{ key: string; name: string; moduleKey: string; animalIds: string[] }[]> {
  const ps = animalProviders().filter(([, p]) => (!species || p.species === species) && p.listWatchlists)
  const lists = await Promise.all(
    ps.map(async ([moduleKey, p]) =>
      (await p.listWatchlists!().catch(() => [])).map((l) => ({ key: `${moduleKey}:${l.id}`, name: ps.length > 1 ? `${l.name} (${p.title})` : l.name, moduleKey, animalIds: l.animalIds })),
    ),
  )
  return lists.flat()
}

const providers = new Map<string, AnimalProvider>()

export function registerAnimalProviders(entries: { key: string; animals?: AnimalProvider }[]): void {
  providers.clear()
  for (const e of entries) if (e.animals) providers.set(e.key, e.animals)
}

export function animalProviders(): [string, AnimalProvider][] {
  return [...providers]
}

export function animalProvider(moduleKey: string): AnimalProvider | undefined {
  return providers.get(moduleKey)
}

/** Alle aktiven Tiere aller Tiermodule. */
export async function listAllAnimals(species?: HerdSpecies): Promise<AnimalRef[]> {
  const lists = await Promise.all(
    animalProviders()
      .filter(([, p]) => !species || p.species === species)
      .map(([, p]) => p.listAnimals().catch(() => [] as AnimalRef[])),
  )
  return lists.flat()
}

// --- Standort eines Tiers (Herdengruppen im Wiesenjournal) ---

export interface AnimalPlace {
  name: string
  since: string
  dayOnly?: boolean
}

export interface AnimalGroupPeriod {
  groupId: string
  groupName: string
  category: string
  categoryLabel: string
  from: string
  /** letzter Tag, null = bis heute */
  to: string | null
  /** Stall und Weide der Gruppe in dieser Zeit (auf die Zeit zugeschnitten) */
  places: { slot: 'stall' | 'weide'; name: string; from: string; to: string | null; dayOnly: boolean }[]
}

export interface AnimalLocation {
  current: (AnimalGroupPeriod & { stall: AnimalPlace | null; weide: AnimalPlace | null }) | null
  /** neueste zuerst */
  history: AnimalGroupPeriod[]
}

export interface HerdLocator {
  /** Pfad zur Herden-Seite, z.B. "/tiere" */
  herdsPath: string
  locate(moduleKey: string, animalId: string, date: string): Promise<AnimalLocation>
  /** Gruppe je Tier an `date` (für Listen; ein Tier ist in höchstens einer Gruppe) */
  groupNames?(animalIds: string[], date: string): Promise<Map<string, string>>
  /** aktive Gruppen mit ihren Einzeltieren an `date` (Gruppenvergleich) */
  groups?(date: string): Promise<{ id: string; name: string; animalIds: string[] }[]>
}

let locator: HerdLocator | null = null
let locatorKey: string | null = null
let herdSyncedAt = 0

export function registerHerdLocator(entries: { key: string; herdLocator?: HerdLocator }[]): void {
  const entry = entries.find((e) => e.herdLocator)
  locator = entry?.herdLocator ?? null
  locatorKey = entry?.key ?? null
}

/** Die Gruppen gehören einem anderen Modul, das sonst nur abgleicht, wenn man
 * es öffnet — die Tierseite zeigte sonst längst aufgelöste Gruppen. Vor dem
 * Anzeigen kurz abgleichen (höchstens einmal pro Minute). true = eben
 * abgeglichen, also neu lesen. */
export async function refreshHerdData(): Promise<boolean> {
  if (!locatorKey || Date.now() - herdSyncedAt < 60_000) return false
  herdSyncedAt = Date.now()
  await syncModuleNow(locatorKey)
  return true
}

/** null, wenn kein Modul Herden führt (Wiesenjournal nicht aktiviert). */
export function herdLocator(): HerdLocator | null {
  return locator
}
