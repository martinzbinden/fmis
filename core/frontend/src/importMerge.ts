// Gemeinsame Regel aller Importe in FMIS: nie löschen, nur ergänzen.
// upsertRow() der Module schreibt alle Spalten und setzt fehlende auf null —
// deshalb geht jeder Import vom bestehenden Datensatz aus und legt nur echte
// Werte aus der Datei darüber (keepExisting), und schreibt nur bei einer
// tatsächlichen Änderung (sameRow).

export function sqlDate(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || a === '') return b == null || b === ''
  if (b == null || b === '') return false
  // pglite liefert date-Spalten als Date (UTC-Mitternacht), numeric als string.
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
  const x = norm(a)
  const y = norm(b)
  if (typeof x === 'boolean' || typeof y === 'boolean') return Boolean(x) === Boolean(y)
  const nx = Number(x)
  const ny = Number(y)
  if (!Number.isNaN(nx) && !Number.isNaN(ny) && String(x).trim() !== '' && String(y).trim() !== '') return nx === ny
  return String(x) === String(y)
}

/** Leere Werte der Importzeile und Spalten, die sie gar nicht kennt (z.B.
 * von Hand erfasst), übernehmen den vorhandenen Wert. */
export function keepExisting<T extends Record<string, unknown>>(row: T, prev: Record<string, unknown> | undefined): T {
  if (!prev) return row
  const out: Record<string, unknown> = { ...row }
  for (const [k, old] of Object.entries(prev)) {
    if (k === 'updated_at' || k === 'deleted_at' || old == null || old === '') continue
    const v = out[k]
    if (v == null || v === '') out[k] = old instanceof Date ? sqlDate(old) : old
  }
  return out as T
}

/** Unterscheidet sich die (bereits mit keepExisting ergänzte) Zeile vom Bestand? */
export function sameRow(row: Record<string, unknown>, prev: Record<string, unknown> | undefined): boolean {
  return !!prev && Object.keys(row).every((k) => sameValue(row[k], prev[k]))
}
