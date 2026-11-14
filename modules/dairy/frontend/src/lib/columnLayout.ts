// Anordnung der Dashboard-Spalten (pages/Board.tsx): Reihenfolge, eingeklappt, gestapelt. Reine Funktionen und die Ablage
// je Gerät (localStorage).

/** Spalten nach gespeicherter Reihenfolge; unbekannte (neue) Spalten folgen in ihrer Grundreihenfolge. */
export function orderColumns<T extends { key: string }>(cols: T[], order: string[]): T[] {
  const index = new Map(order.map((k, i) => [k, i]))
  const known = cols.filter((c) => index.has(c.key)).sort((a, b) => index.get(a.key)! - index.get(b.key)!)
  return [...known, ...cols.filter((c) => !index.has(c.key))]
}

/** `from` vor oder nach `to` einsortieren; liefert die vollständige Reihenfolge aller `allKeys`. */
export function moveKey(order: string[], allKeys: string[], from: string, to: string, after: boolean): string[] {
  if (from === to) return order
  const base = orderColumns(allKeys.map((key) => ({ key })), order).map((c) => c.key)
  const without = base.filter((k) => k !== from)
  const at = without.indexOf(to)
  if (at < 0 || !base.includes(from)) return base
  without.splice(after ? at + 1 : at, 0, from)
  return without
}

export type Lane<T> = { kind: 'column'; col: T } | { kind: 'stack'; cols: T[] }

/** Aufeinanderfolgende eingeklappte Spalten stehen gestapelt in einer gemeinsamen Spur, die anderen je in einer eigenen. */
export function buildLanes<T extends { key: string }>(cols: T[], collapsed: ReadonlySet<string>): Lane<T>[] {
  const lanes: Lane<T>[] = []
  for (const col of cols) {
    if (!collapsed.has(col.key)) {
      lanes.push({ kind: 'column', col })
      continue
    }
    const last = lanes[lanes.length - 1]
    if (last?.kind === 'stack') last.cols.push(col)
    else lanes.push({ kind: 'stack', cols: [col] })
  }
  return lanes
}

const key = (moduleKey: string, what: string) => `${moduleKey}_board_${what}`

export function loadList(moduleKey: string, what: 'column_order' | 'collapsed_columns'): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(moduleKey, what)) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveList(moduleKey: string, what: 'column_order' | 'collapsed_columns', list: string[]): void {
  try {
    localStorage.setItem(key(moduleKey, what), JSON.stringify(list))
  } catch {
    // nur bis zum Neuladen
  }
}
