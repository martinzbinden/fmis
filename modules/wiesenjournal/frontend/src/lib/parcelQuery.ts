// Formeln im Suchfeld der Parzellenliste (pages/Parcels.tsx), Felder siehe core/frontend/src/query/engine.ts.

import type { QueryField } from '@fmis/core/query/engine'
import type { Parcel } from '../types'
import { PARCEL_CATEGORY_LABEL } from './format'

export const PARCEL_QUERY_FIELDS: QueryField<Parcel, null>[] = [
  {
    kind: 'num',
    key: 'flaeche',
    label: 'Fläche',
    unit: 'ha',
    aliases: ['flaeche', 'ha', 'groesse'],
    example: 'Fläche > 2',
    get: (p) => (p.area_a == null ? null : p.area_a / 100),
    units: { ha: 1, a: 1 / 100, ar: 1 / 100 },
    defaultUnit: 'ha',
  },
  { kind: 'flag', key: 'gelan', label: 'aus GELAN übernommen', aliases: ['gelan'], test: (p) => p.source === 'fields' },
  { kind: 'flag', key: 'manuell', label: 'von Hand angelegt', aliases: ['manuell', 'handangelegt'], test: (p) => p.source !== 'fields' },
  { kind: 'choice', key: 'kategorie', label: 'Kategorie', aliases: ['kategorie'], options: (p) => [PARCEL_CATEGORY_LABEL[p.category] ?? p.category] },
  { kind: 'choice', key: 'typ', label: 'Wiesentyp', aliases: ['wiesentyp', 'typ'], options: (p) => [p.wiesentyp ?? ''] },
  { kind: 'choice', key: 'intensitaet', label: 'Intensität', aliases: ['intensitaet'], options: (p) => [p.intensitaet ?? ''] },
  { kind: 'choice', key: 'betrieb', label: 'Betrieb', aliases: ['betrieb', 'farm'], options: (p) => [p.farm_name ?? ''] },
  { kind: 'choice', key: 'kultur', label: 'Kultur', aliases: ['kultur'], options: (p) => [p.kultur_name_de ?? p.kultur_code ?? ''] },
]

export const PARCEL_EXAMPLES = [
  { q: 'Fläche > 2', text: 'grösser als 2 ha' },
  { q: 'Fläche < 50 a', text: 'kleiner als 50 Aren' },
  { q: 'Kategorie = Futter', text: 'nur Futterflächen' },
  { q: 'Intensität = ext', text: 'nach Intensität (der Anfang genügt)' },
  { q: 'gelan und Fläche > 1', text: 'aus GELAN, über 1 ha' },
  { q: 'Weide', text: 'Name enthält «Weide»' },
]

export const PARCEL_SORTS = [
  { key: 'standard', label: 'Betrieb, Kategorie, Name' },
  { key: 'name', label: 'Name' },
  { key: 'flaeche', label: 'Fläche (grösste zuerst)' },
]

export function sortParcels(list: Parcel[], key: string): Parcel[] {
  if (key === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
  if (key === 'flaeche') return [...list].sort((a, b) => (b.area_a ?? -1) - (a.area_a ?? -1))
  return list
}

export const parcelTexts = (p: Parcel) => [p.name, p.notes, p.farm_name, p.kultur_name_de, p.wiesentyp]
