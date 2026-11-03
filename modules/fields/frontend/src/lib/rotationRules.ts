// ÖLN «Geregelte Fruchtfolge» nach DZV (SR 910.13) Art. 16 und Anhang 1 Ziffer 4,
// Stand Fedlex November 2026:
// - Art. 16 Abs. 2: Betriebe mit mehr als 3 ha offener Ackerfläche brauchen jährlich
//   mindestens vier Ackerkulturen (Zählweise Ziff. 4.1) und halten die Höchstanteile
//   der Hauptkulturen ein (Ziff. 4.2.1).
// - Art. 16 Abs. 3 / Ziff. 4.3: wer stattdessen Anbaupausen einhält, braucht die vier
//   Kulturen nicht; die Pausen sind so festzulegen, dass «umgerechnet innerhalb der
//   Fruchtfolge und pro Parzelle» die Höchstanteile eingehalten sind.
// - Ziff. 4.2.2: übrige Ackerkulturen der gleichen Familie: mindestens zwei Jahre Pause.
//
// Die Zuordnung zu den Gruppen geht über den Kulturnamen aus dem GELAN-Import
// (Kulturcodes sind nicht nach diesen Gruppen nummeriert). Unbekannte Kulturen
// zählen als eigene Kultur, aber in keiner Gruppe — die Seite weist darauf hin.

import { classifyKultur } from './kulturCategory'

export type RuleGroup =
  | 'getreide'
  | 'weizen_korn'
  | 'mais'
  | 'hafer'
  | 'rueben'
  | 'kartoffeln'
  | 'raps'
  | 'soja'
  | 'ackerbohnen'
  | 'tabak'
  | 'proteinerbsen'
  | 'sonnenblume'
  | 'raps_sonnenblume'

export interface ShareRule {
  group: RuleGroup
  label: string
  /** Höchstanteil an der Ackerfläche in Prozent (Ziff. 4.2.1) */
  maxPct: number
  /** pro Parzelle umgerechnet (Ziff. 4.3.1): höchstens `max` Jahre in `window` aufeinanderfolgenden Jahren */
  max: number
  window: number
}

// Ziff. 4.2.1 a.–o. Buchstaben d. und e. (Mais mit Untersaat/Maiswiese) sind
// Anbauformen, die der Import nicht unterscheidet — es gilt die strengere Regel c.
export const SHARE_RULES: ShareRule[] = [
  { group: 'getreide', label: 'Getreide (ohne Mais und Hafer)', maxPct: 66, max: 2, window: 3 },
  { group: 'weizen_korn', label: 'Weizen und Korn', maxPct: 50, max: 1, window: 2 },
  { group: 'mais', label: 'Mais', maxPct: 40, max: 2, window: 5 },
  { group: 'hafer', label: 'Hafer', maxPct: 25, max: 1, window: 4 },
  { group: 'rueben', label: 'Rüben', maxPct: 25, max: 1, window: 4 },
  { group: 'kartoffeln', label: 'Kartoffeln', maxPct: 25, max: 1, window: 4 },
  { group: 'raps', label: 'Raps', maxPct: 25, max: 1, window: 4 },
  { group: 'soja', label: 'Sojabohnen', maxPct: 25, max: 1, window: 4 },
  { group: 'ackerbohnen', label: 'Ackerbohnen', maxPct: 25, max: 1, window: 4 },
  { group: 'tabak', label: 'Tabak', maxPct: 25, max: 1, window: 4 },
  // 15 %: einmal in sieben Jahren (14,3 %); zweimal in 13 Jahren wären 15,4 %
  { group: 'proteinerbsen', label: 'Proteinerbsen', maxPct: 15, max: 1, window: 7 },
  { group: 'sonnenblume', label: 'Sonnenblume', maxPct: 25, max: 1, window: 4 },
  { group: 'raps_sonnenblume', label: 'Raps und Sonnenblume', maxPct: 33, max: 1, window: 3 },
]

export const RULE_SOURCE = 'DZV Art. 16 und Anhang 1 Ziffer 4'

export interface CropInfo {
  /** Schlüssel für das Zählen der Kulturen (gleiche Kultur, auch mit/ohne BFF-Zusatz) */
  key: string
  label: string
  groups: RuleGroup[]
  /** offene Ackerfläche (Kulturcodes 500–599) */
  open: boolean
  kunstwiese: boolean
  /** Name fehlt — keiner Gruppe zuzuordnen */
  unknown: boolean
}

/** «GiwR Winterweizen (BFF)» → «Winterweizen»: Anbauform und Programm sind dieselbe Kultur. */
export function cropLabel(name: string | null, code: string): string {
  const n = (name ?? '')
    .replace(/^GiwR\s+/i, '')
    .replace(/\s*\((BFF|Biodiversitätsförderfläche)\)\s*$/i, '')
    .replace(/^insitu\s+/i, '')
    .trim()
  return n || `Code ${code}`
}

export function cropInfo(code: string, name: string | null): CropInfo {
  const label = cropLabel(name, code)
  const n = label.toLowerCase()
  const open = classifyKultur(code) === 'acker'
  const kunstwiese = /kunstwiese/.test(n)
  const groups: RuleGroup[] = []
  if (open) {
    if (/mais/.test(n)) groups.push('mais')
    else if (/hafer/.test(n)) groups.push('hafer')
    else if (/(?<!buch)weizen|dinkel|\bkorn\b|emmer|einkorn/.test(n)) groups.push('getreide', 'weizen_korn')
    else if (/gerste|roggen|triticale|getreide/.test(n)) groups.push('getreide')
    if (/rübe|ruebe/.test(n)) groups.push('rueben')
    if (/kartoffel/.test(n)) groups.push('kartoffeln')
    if (/raps/.test(n)) groups.push('raps', 'raps_sonnenblume')
    if (/sonnenblume/.test(n)) groups.push('sonnenblume', 'raps_sonnenblume')
    if (/soja/.test(n)) groups.push('soja')
    if (/ackerbohne/.test(n)) groups.push('ackerbohnen')
    if (/tabak/.test(n)) groups.push('tabak')
    if (/eiweisserbse|proteinerbse/.test(n)) groups.push('proteinerbsen')
  }
  return { key: label.toLowerCase(), label, groups, open, kunstwiese, unknown: !name?.trim() }
}

/** Hauptkultur einer Parzelle in einem Jahr (Position 1; Position 2+ ist Zwischenfutter). */
export interface MainCrop {
  lineage_id: string
  farm_id: string
  jahr: number
  kultur_code: string
  kultur_name_de: string | null
  area_a: number | null
  sequence_in_year: number
}

export interface ShareResult {
  rule: ShareRule
  pct: number
  ok: boolean
}

export interface YearCheck {
  jahr: number
  /** offene Ackerfläche in ha */
  openHa: number
  /** Ackerfläche (offen + Kunstwiese) in ha */
  arableHa: number
  /** Regeln gelten (mehr als 3 ha offene Ackerfläche) */
  applies: boolean
  cultures: number
  culturesOk: boolean
  shares: ShareResult[]
  unknown: string[]
}

const r1 = (x: number) => Math.round(x * 10) / 10

/** Anzahl Kulturen nach Ziff. 4.1.1/4.1.2 aus den Anteilen an der Ackerfläche (0–1). */
export function countCultures(shares: { share: number; kunstwiese: boolean }[]): number {
  let n = 0
  let small = 0
  for (const s of shares) {
    if (s.kunstwiese && s.share >= 0.3) n += 3
    else if (s.kunstwiese && s.share >= 0.2) n += 2
    else if (s.share >= 0.1) n += 1
    else small += s.share
  }
  // Kulturen unter 10 % zusammen: je angefangene Tranche über 10 % eine Kultur
  return n + Math.floor(small / 0.1 + 1e-9)
}

/** ÖLN-Prüfung eines Betriebs für ein Jahr (nur Hauptkulturen). */
export function checkYear(jahr: number, crops: MainCrop[]): YearCheck {
  const main = crops.filter((c) => c.jahr === jahr && c.sequence_in_year === 1)
  const byKey = new Map<string, { area: number; kunstwiese: boolean; groups: RuleGroup[] }>()
  let openA = 0
  let arableA = 0
  const unknown = new Set<string>()
  for (const c of main) {
    const info = cropInfo(c.kultur_code, c.kultur_name_de)
    if (!info.open && !info.kunstwiese) continue
    const a = c.area_a ?? 0
    arableA += a
    if (info.open) openA += a
    if (info.unknown && info.open) unknown.add(info.label)
    const e = byKey.get(info.key) ?? { area: 0, kunstwiese: info.kunstwiese, groups: info.groups }
    e.area += a
    byKey.set(info.key, e)
  }
  const shareOf = (a: number) => (arableA > 0 ? a / arableA : 0)
  const cultures = countCultures([...byKey.values()].map((e) => ({ share: shareOf(e.area), kunstwiese: e.kunstwiese })))
  const shares: ShareResult[] = []
  for (const rule of SHARE_RULES) {
    const area = [...byKey.values()].filter((e) => e.groups.includes(rule.group)).reduce((s, e) => s + e.area, 0)
    if (area === 0) continue
    const pct = r1(shareOf(area) * 100)
    shares.push({ rule, pct, ok: pct <= rule.maxPct })
  }
  const openHa = openA / 100
  return {
    jahr,
    openHa,
    arableHa: arableA / 100,
    applies: openHa > 3,
    cultures,
    culturesOk: cultures >= 4,
    shares,
    unknown: [...unknown],
  }
}

export interface ParcelHint {
  lineage_id: string
  jahr: number
  rule: ShareRule
  /** Jahre im Fenster mit Kultur dieser Gruppe */
  years: number[]
}

/** Anbaupausen pro Parzelle (Ziff. 4.3.1): je Gruppe höchstens `max` Jahre in
 * `window` aufeinanderfolgenden Jahren. Markiert jedes Jahr eines zu dichten Fensters. */
export function parcelHints(crops: MainCrop[]): ParcelHint[] {
  const byLineage = new Map<string, Map<number, CropInfo>>()
  for (const c of crops) {
    if (c.sequence_in_year !== 1) continue
    const m = byLineage.get(c.lineage_id) ?? new Map<number, CropInfo>()
    m.set(c.jahr, cropInfo(c.kultur_code, c.kultur_name_de))
    byLineage.set(c.lineage_id, m)
  }
  const hints = new Map<string, ParcelHint>()
  for (const [lineage, years] of byLineage) {
    const all = [...years.keys()]
    const first = Math.min(...all)
    const last = Math.max(...all)
    for (const rule of SHARE_RULES) {
      for (let start = first - rule.window + 1; start <= last; start++) {
        const hit: number[] = []
        for (let y = start; y < start + rule.window; y++) if (years.get(y)?.groups.includes(rule.group)) hit.push(y)
        if (hit.length <= rule.max) continue
        for (const y of hit) {
          const k = `${lineage}|${y}|${rule.group}`
          if (!hints.has(k)) hints.set(k, { lineage_id: lineage, jahr: y, rule, years: hit })
        }
      }
    }
  }
  return [...hints.values()]
}

/** Kurztext zu einer Regel für Hinweise und Tooltips. */
export function ruleText(rule: ShareRule): string {
  return `${rule.label}: höchstens ${rule.max === 1 ? 'einmal' : `${rule.max}-mal`} in ${rule.window} Jahren (max. ${rule.maxPct} %)`
}
