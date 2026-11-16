// Laufhof/Auslauf je Tierkategorie und Tag (Etappe «Laufhof-Auswahl», Vorgabe des Betriebs 12.11.2026):
// auto = X, wenn die Kategorie an diesem Tag einer Weide zugewiesen ist (Nutzung «Weide» im Journal), sonst leer;
// L = Laufhof, 0 = kein Auslauf, dazu Ausnahmen (Einzeltier, Krankheit, Vogelgrippe …) als eigene Zeiträume.

import type { Store } from '../db/store'
import { ANIMAL_CATEGORIES } from './format'
import type { AnimalCategory, AuslaufAusnahme, AusnahmeGrund, DailyFarmLog, LaufhofWert, UsageEntry } from '../types'

export const GRUND_LABEL: Record<AusnahmeGrund, string> = {
  einzeltier: 'Einzeltier ohne Auslauf',
  krankheit: 'Krankheit / Verletzung',
  geburt: 'Geburt (um den Abkalbetermin)',
  eingriff: 'Eingriff / Behandlung',
  transport: 'Transport / Markt',
  witterung: 'Witterung / Boden (Weide geschont)',
  behoerde: 'Behördliche Anordnung (z.B. Vogelgrippe)',
  andere: 'Andere',
}

export interface LaufhofZelle {
  zeichen: '' | 'X' | 'L' | '0'
  /** aus dem Journal abgeleitet (auto), nicht von Hand gesetzt */
  auto: boolean
  ausnahmen: AuslaufAusnahme[]
}

/** Tierkategorien, die an einem Tag auf einer Weide sind (Nutzung «Weide» mit Tierkategorie). */
export function weideKategorien(usage: UsageEntry[]): Map<string, Set<AnimalCategory>> {
  const m = new Map<string, Set<AnimalCategory>>()
  for (const u of usage) {
    if (u.usage_type !== 'weide' || !u.animal_category) continue
    const s = m.get(u.entry_date) ?? new Set<AnimalCategory>()
    s.add(u.animal_category)
    m.set(u.entry_date, s)
  }
  return m
}

/** Kategorien mit Laufhof-Zeile: immer Kühe und Rinder, dazu alle, die auf Weide waren, gesetzt sind oder Ausnahmen haben. */
export function laufhofKategorien(weideAm: Map<string, Set<AnimalCategory>>, logs: DailyFarmLog[], ausnahmen: AuslaufAusnahme[]): AnimalCategory[] {
  const k = new Set<AnimalCategory>(['kuehe', 'rinder'])
  for (const s of weideAm.values()) s.forEach((c) => k.add(c))
  for (const l of logs) for (const c of ANIMAL_CATEGORIES) if ((l as unknown as Record<string, LaufhofWert>)[`laufhof_${c}`]) k.add(c)
  for (const a of ausnahmen) k.add(a.kategorie)
  return ANIMAL_CATEGORIES.filter((c) => k.has(c))
}

export function ausnahmenAm(alle: AuslaufAusnahme[], datum: string, kategorie: AnimalCategory): AuslaufAusnahme[] {
  return alle.filter((a) => a.kategorie === kategorie && a.von <= datum && datum <= a.bis)
}

/** auto: X, wenn auf Weide; sonst der Auslauf einer Herde im Stall (L/0); sonst leer. */
export function laufhofZelle(wert: LaufhofWert | undefined, aufWeide: boolean, ausnahmen: AuslaufAusnahme[], stall?: 'L' | '0' | null): LaufhofZelle {
  if (wert === 'X' || wert === 'L' || wert === '0') return { zeichen: wert, auto: false, ausnahmen }
  return { zeichen: aufWeide ? 'X' : (stall ?? ''), auto: true, ausnahmen }
}

/** Laufhof-Wert eines Tages setzen (null = auto); legt die Tagesmeldung an, falls es sie noch nicht gibt. */
export function laufhofSetzen(s: Store, datum: string, kategorie: AnimalCategory, wert: LaufhofWert): void {
  const log = s.rows('daily_farm_log').find((l) => l.entry_date === datum)
  const feld = `laufhof_${kategorie}` as keyof DailyFarmLog
  s.put('daily_farm_log', { id: log?.id ?? crypto.randomUUID(), entry_date: datum, [feld]: wert } as Partial<DailyFarmLog> & { id: string })
}

export function ausnahmeSpeichern(s: Store, a: Omit<AuslaufAusnahme, 'id' | 'updated_at' | 'deleted_at'> & { id?: string }): string {
  const id = a.id ?? crypto.randomUUID()
  const [von, bis] = a.von <= a.bis ? [a.von, a.bis] : [a.bis, a.von]
  s.put('auslauf_ausnahmen', { ...a, id, von, bis })
  return id
}

export function ausnahmeText(a: AuslaufAusnahme): string {
  const wer = a.tier ? a.tier : a.anzahl ? `${a.anzahl} Tiere` : 'alle'
  return `${GRUND_LABEL[a.grund]}${a.freitext ? ` (${a.freitext})` : ''} · ${wer} · ${a.von === a.bis ? a.von.split('-').reverse().join('.') : `${a.von.split('-').reverse().join('.')}–${a.bis.split('-').reverse().join('.')}`}`
}
