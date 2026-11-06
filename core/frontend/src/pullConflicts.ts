// Pull: eine Server-Zeile scheitert an einem anderen eindeutigen Feld als der id
// (z.B. animals.ear_tag, pedigree.animal_key, animal_journal.import_key). Das
// passiert, wenn zwei Geräte dasselbe Tier (dieselbe Ohrmarke) unabhängig
// anlegen: lokal gibt es dann eine zweite Zeile mit anderer id. Ohne
// Bereinigung bricht jeder Pull ab und das Gerät bekommt nichts mehr.
//
// Regel: der Server gewinnt. Die lokale Doppelzeile wird mit der Server-Zeile
// zusammengeführt — Verweise darauf (z.B. Journal-Einträge zum Tier) zeigen
// danach auf die Server-Zeile und werden neu gesendet — und dann gelöscht.

/** Zugriff innerhalb der Pull-Transaktion (PGlite-Transaktion). */
interface Tx {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

/** "Key (ear_tag)=(CH90000130) already exists." → { ear_tag: 'CH90000130' }.
 * Mehrteilige Schlüssel: "Key (a, b)=(1, x)". Gibt null, wenn nicht lesbar. */
export function parseUniqueDetail(detail: string | undefined): Record<string, string> | null {
  const m = /^Key \((.+)\)=\((.*)\) already exists\.?$/.exec(detail ?? '')
  if (!m) return null
  const cols = m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const vals = cols.length === 1 ? [m[2]] : m[2].split(', ')
  if (vals.length !== cols.length || cols.some((c) => !/^[a-z_][a-z0-9_]*$/.test(c))) return null
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]))
}

export function isUniqueViolation(e: unknown): e is { code: string; constraint?: string; detail?: string } {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

/**
 * Lokale Zeilen, die mit der Server-Zeile `row` an einem eindeutigen Feld
 * zusammenstossen, beiseiteschieben (Wert umbenennen), damit die Server-Zeile
 * eingefügt werden kann. Gibt die ids der beiseitegeschobenen Zeilen zurück
 * (nach dem Einfügen mit mergeInto() zusammenführen) oder null, wenn der
 * Konflikt nicht zu lösen ist.
 */
export async function setAsideConflicts(tx: Tx, table: string, row: Record<string, unknown>, error: { constraint?: string; detail?: string }): Promise<string[] | null> {
  if (error.constraint === `${table}_pkey`) return null
  const key = parseUniqueDetail(error.detail)
  if (!key) return null
  const cols = Object.keys(key)
  const where = cols.map((c, i) => `"${c}"::text = $${i + 1}`).join(' and ')
  const { rows } = await tx.query<{ id: string }>(`select id::text as id from "${table}" where ${where} and id::text <> $${cols.length + 1}`, [
    ...cols.map((c) => key[c]),
    String(row.id),
  ])
  if (rows.length === 0) return null
  // nur Textspalten lassen sich eindeutig verändern; Zahlen/Datum: kein automatischer Ausweg
  const textCol = cols[cols.length - 1]
  const { rows: type } = await tx.query<{ data_type: string }>(
    `select data_type from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = $2`,
    [table, textCol],
  )
  if (!['text', 'character varying'].includes(type[0]?.data_type ?? '')) return null
  for (const r of rows) {
    await tx.query(`update "${table}" set "${textCol}" = "${textCol}"::text || $1 where id::text = $2`, [`~doppelt-${r.id.slice(0, 8)}`, r.id])
  }
  return rows.map((r) => r.id)
}

/** Verweise von der lokalen Doppelzeile auf die Server-Zeile umhängen (neu
 * senden), dann die Doppelzeile löschen und aus der Outbox nehmen. */
export async function mergeInto(tx: Tx, table: string, localId: string, serverId: string): Promise<void> {
  const { rows: fks } = await tx.query<{ tbl: string; col: string }>(
    `select c.conrelid::regclass::text as tbl, a.attname as col
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = $1::regclass`,
    [`"${table}"`],
  )
  const now = new Date().toISOString()
  for (const fk of fks) {
    const { rows: moved } = await tx.query<{ id: string }>(
      `update ${fk.tbl} set "${fk.col}" = $1, updated_at = $3 where "${fk.col}"::text = $2 returning id::text as id`,
      [serverId, localId, now],
    )
    const bare = fk.tbl.replace(/^.*\./, '').replace(/"/g, '')
    for (const m of moved) {
      await tx.query(
        `insert into sync_outbox (table_name, row_id, updated_at) values ($1, $2, $3)
         on conflict (table_name, row_id) do update set updated_at = excluded.updated_at`,
        [bare, m.id, now],
      )
    }
  }
  await tx.query(`delete from "${table}" where id::text = $1`, [localId])
  await tx.query(`delete from sync_outbox where table_name = $1 and row_id::text = $2`, [table, localId])
}
