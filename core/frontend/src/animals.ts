// Tiere modulübergreifend: Herdengruppen und Standorte (Wiesenjournal →
// Herden) verknüpfen Einzeltiere aus den Tiermodulen (Milchschafe,
// Milchkühe, Mastplaner), ohne deren Daten zu kopieren. Jedes Tiermodul
// stellt dafür einen AnimalProvider bereit (ModuleDescriptor.animals); die
// Shell registriert die aktivierten beim Start (frontend/src/App.tsx).

export type HerdSpecies = 'schafe' | 'rinder'

export interface AnimalRef {
  moduleKey: string
  id: string
  ear_tag: string
  lauf_nr: string | null
  name: string | null
  /** "2212 · 1967.8805" — Laufnummer und kurze Ohrmarke */
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

export interface AnimalProvider {
  title: string
  species: HerdSpecies
  /** Aktive Tiere des Moduls (lokale Datenbank). */
  listAnimals(): Promise<AnimalRef[]>
  /** Trockenstellen ab Datum (Milchmodule). */
  dryOff?(animalIds: string[], date: string, note: string): Promise<void>
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
