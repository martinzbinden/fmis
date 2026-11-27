// Eigene Reihenfolge der Parzellen (parcels.sort_order), wie sie Raster plus und Finder unter «eigene Reihenfolge»
// zeigen. Geordnet wird auf der Seite Parzellen mit ▲▼ (?ordnen=1 oder Knopf «Reihenfolge ändern»).

export interface OrderItem {
  id: string
  name: string
  sort_order: number | null
}

export function byOwnOrder(a: OrderItem, b: OrderItem): number {
  return (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.name.localeCompare(b.name, 'de-CH', { numeric: true })
}

/**
 * Schiebt `id` vor (`up`) oder hinter (`down`) die Nachbarparzelle `neighborId` und nummeriert alle Parzellen des
 * Jahres neu durch (0, 1, 2 …). Zurück kommen nur die Zeilen, deren sort_order sich ändert.
 */
export function moveParcel(all: OrderItem[], id: string, neighborId: string, dir: 'up' | 'down'): { id: string; sort_order: number }[] {
  const sorted = [...all].sort(byOwnOrder)
  const moving = sorted.find((p) => p.id === id)
  if (!moving || id === neighborId) return []
  const rest = sorted.filter((p) => p.id !== id)
  const at = rest.findIndex((p) => p.id === neighborId)
  if (at < 0) return []
  rest.splice(dir === 'up' ? at : at + 1, 0, moving)
  return rest.flatMap((p, i) => (p.sort_order === i ? [] : [{ id: p.id, sort_order: i }]))
}
