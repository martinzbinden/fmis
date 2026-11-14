// Formeln im Suchfeld der Maschinenliste (pages/Machines.tsx): Felder der Maschinen (core/frontend/src/query/engine.ts).

import type { QueryField } from '@fmis/core/query/engine'
import type { Machine } from '../types'
import { MACHINE_KIND_LABEL } from './machines'

export const MACHINE_QUERY_FIELDS: QueryField<Machine, null>[] = [
  { kind: 'num', key: 'ps', label: 'Leistung (Traktoren)', unit: 'PS', aliases: ['ps', 'leistung', 'hp'], example: 'PS > 100', get: (m) => m.power_hp },
  { kind: 'num', key: 'baujahr', label: 'Baujahr', unit: '', aliases: ['baujahr', 'jahrgang'], example: 'Baujahr < 2005', get: (m) => m.year_built },
  { kind: 'num', key: 'breite', label: 'Arbeitsbreite', unit: 'm', aliases: ['arbeitsbreite', 'breite'], example: 'Breite >= 3', get: (m) => m.width_m },
  { kind: 'num', key: 'kapazitaet', label: 'Fassgrösse / Ladevolumen', unit: 'm³ bzw. t', aliases: ['kapazitaet', 'fassgroesse', 'volumen', 'fass'], example: 'Fassgrösse > 5', get: (m) => m.capacity },
  { kind: 'num', key: 'gewicht', label: 'Gewicht', unit: 'kg', aliases: ['gewicht'], example: 'Gewicht > 3000', get: (m) => m.weight_kg },
  { kind: 'flag', key: 'aktiv', label: 'aktiv', aliases: ['aktiv'], test: (m) => m.active },
  { kind: 'flag', key: 'inaktiv', label: 'nicht aktiv', aliases: ['inaktiv', 'nichtaktiv'], test: (m) => !m.active },
  { kind: 'flag', key: 'eigen', label: 'eigene Maschine', aliases: ['eigen', 'eigene'], test: (m) => !m.owner },
  { kind: 'flag', key: 'fremd', label: 'fremde Maschine (Nachbar, Lohnunternehmer)', aliases: ['fremd', 'fremde'], test: (m) => !!m.owner },
  { kind: 'flag', key: 'fzw', label: 'mit Frontzapfwelle', aliases: ['frontzapfwelle', 'fzw'], test: (m) => !!(m as { front_pto?: boolean }).front_pto },
  { kind: 'choice', key: 'art', label: 'Art', aliases: ['art', 'typ'], options: (m) => [MACHINE_KIND_LABEL[m.kind] ?? m.kind] },
  { kind: 'choice', key: 'hersteller', label: 'Hersteller', aliases: ['hersteller', 'marke'], options: (m) => [m.manufacturer ?? ''] },
  { kind: 'choice', key: 'besitzer', label: 'Eigentümer', aliases: ['besitzer', 'eigentuemer', 'gehoert'], options: (m) => [m.owner ?? ''] },
]

export const MACHINE_EXAMPLES = [
  { q: 'PS > 100', text: 'Traktoren mit mehr als 100 PS' },
  { q: 'Baujahr < 2005', text: 'vor 2005 gebaut' },
  { q: 'Breite >= 3', text: 'Arbeitsbreite ab 3 m' },
  { q: 'Fassgrösse > 5 und aktiv', text: 'grosse Fässer, noch in Betrieb' },
  { q: 'fremd', text: 'Maschinen von Nachbarn oder Lohnunternehmern' },
  { q: 'Hersteller = Fendt', text: 'nach Hersteller (der Anfang genügt)' },
  { q: 'Fendt', text: 'Name enthält «Fendt»' },
]

export const MACHINE_SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'baujahr', label: 'Baujahr (neueste zuerst)' },
  { key: 'ps', label: 'Leistung (stärkste zuerst)' },
  { key: 'breite', label: 'Arbeitsbreite (breiteste zuerst)' },
]

export function sortMachines(list: Machine[], key: string): Machine[] {
  const out = [...list]
  const by = (get: (m: Machine) => number | null) => out.sort((a, b) => (get(b) ?? -1) - (get(a) ?? -1) || a.name.localeCompare(b.name, 'de'))
  if (key === 'baujahr') return by((m) => m.year_built)
  if (key === 'ps') return by((m) => m.power_hp)
  if (key === 'breite') return by((m) => m.width_m)
  return out
}

export const machineTexts = (m: Machine) => [m.name, m.manufacturer, m.model, m.type_no, m.serial_no, m.notes, m.owner]
