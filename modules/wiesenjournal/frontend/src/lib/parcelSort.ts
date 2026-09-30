import type { Parcel } from '../types'
import { num } from './format'

export type SortField = 'name' | 'area' | 'kultur'
export interface SortState {
  field: SortField | null
  dir: 'asc' | 'desc'
}

function sortValue(p: Parcel, field: SortField): string | number {
  if (field === 'name') return p.name.toLowerCase()
  if (field === 'area') return num(p.area_a) ?? -1
  return (p.kultur_name_de ?? '').toLowerCase()
}

export function sortParcels(parcels: Parcel[], sort: SortState): Parcel[] {
  if (!sort.field) return parcels
  const dir = sort.dir === 'asc' ? 1 : -1
  const field = sort.field
  return [...parcels].sort((a, b) => {
    const av = sortValue(a, field)
    const bv = sortValue(b, field)
    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
}

/** Nächster Klick auf dasselbe Feld dreht die Richtung um, ein neues Feld startet aufsteigend. */
export function nextSortState(current: SortState, field: SortField): SortState {
  if (current.field !== field) return { field, dir: 'asc' }
  return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}
