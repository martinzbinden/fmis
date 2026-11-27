// Suche über den ganzen Betrieb (core/frontend/src/GlobalSearch.tsx): Tiere aller Tiermodule, Funktionen (Seiten) aller
// Module und weitere Treffer, die ein Modul selbst liefert (ModuleDescriptor.search: Tiergruppen, Merklisten,
// Parzellen, Maschinen, Personen, Bauprojekte …). Alles läuft auf der lokalen Datenbank, also auch ohne Empfang.

import type { ModuleDescriptor } from './ModuleDescriptor'
import { animalProviders, type AnimalRef } from './animals'
import { animalKey } from './earTag'
import { nameAndBirthMatch, parseAnimalQuery } from './animalQuery'

/** Reihenfolge der Gruppen in der Trefferliste */
export const SEARCH_GROUPS = {
  tiere: 'Tiere',
  funktionen: 'Funktionen',
  gruppen: 'Tiergruppen und Merklisten',
  flaechen: 'Parzellen',
  maschinen: 'Maschinen',
  personen: 'Personen',
  bau: 'Bauprojekte',
} as const
export type SearchGroup = keyof typeof SEARCH_GROUPS

export interface SearchAction {
  label: string
  icon: string
  to: string
}

export interface SearchHit {
  /** eindeutig über alle Gruppen */
  key: string
  group: SearchGroup
  title: string
  subtitle?: string
  icon?: string
  /** Ziel in der App (absolut, z.B. /dairy_schafe/tierinfo?tier=…) */
  to: string
  /** Direktknöpfe unter dem Treffer, z.B. Behandlung für ein Tier */
  actions?: SearchAction[]
  /** kleiner = weiter oben (0 = genau, 1 = Anfang, 2 = enthalten) */
  rank: number
}

/** Seite eines Moduls für die Gruppe «Funktionen». */
export interface FunctionEntry {
  /** Pfad im Modul (ohne Modul), z.B. 'geburt' oder 'laemmer?aktion=absetzen' */
  to: string
  label: string
  icon?: string
  /** weitere Suchwörter, z.B. «ablammen, abkalben» für Geburt */
  keywords?: string
}

/** Kleinbuchstaben, Umlaute und Akzente vereinfacht, Satzzeichen zu Leerzeichen. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Wie gut passt `q` zu den Texten? null = gar nicht. Jedes Suchwort muss vorkommen; Rang nach dem besten Wort. */
export function textRank(q: string, ...texts: (string | null | undefined)[]): number | null {
  const words = norm(q).split(' ').filter(Boolean)
  if (words.length === 0) return null
  const hay = texts.filter(Boolean).map((t) => norm(t!))
  const all = hay.join(' ')
  if (!words.every((w) => all.includes(w))) return null
  const joined = words.join(' ')
  if (hay.some((h) => h === joined)) return 0
  if (hay.some((h) => h.startsWith(joined) || h.split(' ').some((part) => part.startsWith(words[0])))) return 1
  return 2
}

/** Funktionen eines Moduls: eigene Liste (functions) oder aus Fussleiste und Seitentiteln abgeleitet. */
export function moduleFunctions(m: Pick<ModuleDescriptor, 'key' | 'title' | 'navItems' | 'pageTitles' | 'functions'>): (FunctionEntry & { moduleKey: string; moduleTitle: string })[] {
  const out = new Map<string, FunctionEntry>()
  for (const f of m.functions ?? []) out.set(f.to, f)
  for (const n of m.navItems) if (!out.has(n.to) && !n.resolve) out.set(n.to, { to: n.to, label: n.label, icon: n.icon })
  for (const [path, label] of Object.entries(m.pageTitles ?? {})) {
    if (path.includes(':') || out.has(path)) continue
    if ([...out.values()].some((f) => f.label === label)) continue
    out.set(path, { to: path, label })
  }
  return [...out.values()].map((f) => ({ ...f, moduleKey: m.key, moduleTitle: m.title }))
}

/** Pfad einer Funktion: relative Ziele unter dem Modul, absolute (beginnt mit «/») unverändert. */
export function functionPath(moduleKey: string, to: string): string {
  if (to.startsWith('/')) return to
  return `/${moduleKey}${to ? `/${to}` : ''}`
}

export function functionHits(modules: Pick<ModuleDescriptor, 'key' | 'title' | 'icon' | 'navItems' | 'pageTitles' | 'functions'>[], q: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const m of modules) {
    for (const f of moduleFunctions(m)) {
      const r = textRank(q, f.label, f.keywords, m.title)
      // nur der Modulname passt: schwächer
      const own = textRank(q, f.label, f.keywords)
      if (r == null) continue
      hits.push({
        key: `f:${m.key}:${f.to}`,
        group: 'funktionen',
        title: f.label,
        subtitle: m.title,
        icon: f.icon ?? m.icon,
        to: functionPath(m.key, f.to),
        rank: own == null ? 3 : r,
      })
    }
  }
  return hits
}

/** Ziffern der Nummer (Laufnummer oder Ohrmarke ohne CH/Punkte). */
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** Wie gut passt `q` zu einem Tier? Ziffern: Laufnummer genau/Anfang, Ohrmarke Ende/enthalten; Buchstaben: Name. */
export function animalRank(q: string, a: Pick<AnimalRef, 'ear_tag' | 'lauf_nr' | 'name'> & { birth_date?: string | null }): number | null {
  const t = q.trim()
  if (!t) return null
  // Geburtsdatum (auch mit Name oder Nummer kombiniert): «12.3.2021», «12.3.», «3.2021»
  const parsed = parseAnimalQuery(t)
  if (parsed.dates.length > 0 || (parsed.words.length > 0 && parsed.number)) {
    if (!nameAndBirthMatch(parsed, { name: a.name, birth_date: a.birth_date ?? null })) return null
    if (!parsed.number) return 1
    const r = animalRank(parsed.number, a)
    return r == null ? null : r
  }
  const qd = digits(t)
  if (qd && qd.length === t.replace(/[\s.]/g, '').length) {
    const lauf = digits(a.lauf_nr)
    const ear = digits(animalKey(a.ear_tag) ?? a.ear_tag)
    if (lauf && lauf === qd) return 0
    if (ear.endsWith(qd) && qd.length >= 4) return qd.length >= 8 ? 0 : 1
    if (lauf.startsWith(qd)) return 1
    if (qd.length >= 4 && ear.includes(qd)) return 2
    return null
  }
  // Ohrmarke mit Buchstaben (CH…)
  const key = animalKey(t)
  if (key && key === animalKey(a.ear_tag)) return 0
  return textRank(t, a.name, a.lauf_nr)
}

// Tierlisten kurz zwischenspeichern: die Suche fragt bei jedem Tastendruck
let animalCache: { at: number; list: Promise<{ moduleKey: string; title: string; animals: AnimalRef[] }[]> } | null = null
export function clearSearchCache(): void {
  animalCache = null
}

function allAnimals(): Promise<{ moduleKey: string; title: string; animals: AnimalRef[] }[]> {
  if (!animalCache || Date.now() - animalCache.at > 60_000) {
    animalCache = {
      at: Date.now(),
      list: Promise.all(animalProviders().map(async ([moduleKey, p]) => ({ moduleKey, title: p.title, animals: await p.listAnimals().catch(() => []) }))),
    }
  }
  return animalCache.list
}

export async function animalHits(q: string): Promise<SearchHit[]> {
  const lists = await allAnimals()
  const providers = new Map(animalProviders())
  const several = lists.filter((l) => l.animals.length > 0).length > 1
  const hits: SearchHit[] = []
  for (const { moduleKey, title, animals } of lists) {
    const p = providers.get(moduleKey)
    for (const a of animals) {
      const rank = animalRank(q, a)
      if (rank == null) continue
      const link = p?.searchLinks?.(a)
      hits.push({
        key: `a:${moduleKey}:${a.id}`,
        group: 'tiere',
        title: [a.lauf_nr, a.name].filter(Boolean).join(' ') || a.label,
        subtitle: [a.label, a.sex === 'm' ? '♂' : a.sex === 'w' ? '♀' : null, a.birth_date ? `geb. ${a.birth_date.slice(8, 10)}.${a.birth_date.slice(5, 7)}.${a.birth_date.slice(0, 4)}` : null, several ? title : null].filter(Boolean).join(' · '),
        icon: a.species === 'schafe' ? 'schaf' : 'kuh',
        to: link?.to ?? `/${moduleKey}`,
        actions: link?.actions,
        rank,
      })
    }
  }
  return hits
}

const byRank = (a: SearchHit, b: SearchHit) => a.rank - b.rank || a.title.localeCompare(b.title, 'de', { numeric: true })

/** Alle Treffer, nach Gruppe in fester Reihenfolge, innerhalb nach Rang. */
export async function searchAll(modules: ModuleDescriptor[], q: string): Promise<{ group: SearchGroup; hits: SearchHit[] }[]> {
  if (!q.trim()) return []
  const parts = await Promise.all([
    animalHits(q).catch(() => []),
    Promise.resolve(functionHits(modules, q)),
    ...modules.filter((m) => m.search).map((m) => m.search!(q).catch(() => [] as SearchHit[])),
  ])
  const all = parts.flat()
  return (Object.keys(SEARCH_GROUPS) as SearchGroup[])
    .map((group) => ({ group, hits: all.filter((h) => h.group === group).sort(byRank) }))
    .filter((g) => g.hits.length > 0)
}

// ---- zuletzt geöffnet (für die leere Suche und «Mehr») ----

export interface RecentPage {
  /** Pfad mit Suchteil, z.B. /dairy_schafe/geburt */
  path: string
  title: string
  /** z.B. Modul («Milchschafe») */
  sub?: string
  icon?: string
  at: number
}

const RECENT_KEY = 'fmis_recent_pages'
const RECENT_MAX = 30

export function readRecent(): RecentPage[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentPage[]
    return Array.isArray(v) ? v.filter((r) => r && typeof r.path === 'string' && typeof r.title === 'string') : []
  } catch {
    return []
  }
}

/** Seite oder Treffer als zuletzt benutzt merken (neueste zuerst, jeder Pfad einmal). */
export function recordRecent(page: Omit<RecentPage, 'at'>): void {
  try {
    const list = [{ ...page, at: Date.now() }, ...readRecent().filter((r) => r.path !== page.path)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // ohne Speicher: nichts merken
  }
}
