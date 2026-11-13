// Gleichzeitige, identische Lese-Abfragen teilen sich EINE Ausführung. Eine Seite stellt oft dieselbe Abfrage
// mehrfach (z.B. Tiere, Belegungen, Geburten für Hinweise, Tierarzt und Milchmengen); die Verbindung zur
// Browser-Datenbank ist seriell, jede Doppelung kostet also Zeit.
//
// Sicher, weil nur Abfragen zusammengelegt werden, die gleichzeitig offen sind UND zwischen denen kein
// Schreibvorgang gestartet wurde (invalidate() bei jedem Schreiben): Wer nach einem Schreiben liest,
// bekommt nie das Ergebnis einer Abfrage von davor. Jeder Aufrufer bekommt eigene Zeilen (Kopie), damit
// niemand dem anderen Zeilen verändert.

interface Entry<R> {
  n: number
  promise: Promise<R>
}

export function createReadDeduper<R extends { rows: unknown[] }>() {
  const pending = new Map<string, Entry<R>>()
  return {
    read(key: string, run: () => Promise<R>): Promise<R> {
      let entry = pending.get(key)
      if (entry) entry.n++
      else {
        const created: Entry<R> = { n: 1, promise: null as unknown as Promise<R> }
        created.promise = run().finally(() => {
          if (pending.get(key) === created) pending.delete(key)
        })
        pending.set(key, created)
        entry = created
      }
      const shared = entry
      // n ist beim Abschluss endgültig: wurde die Abfrage geteilt, bekommt jeder eine eigene Kopie der Zeilen
      return shared.promise.then((r) => (shared.n > 1 ? { ...r, rows: structuredClone(r.rows) } : r))
    },
    /** Bei jedem Schreibvorgang: spätere Abfragen dürfen sich nicht an frühere anhängen. */
    invalidate(): void {
      pending.clear()
    },
    get size(): number {
      return pending.size
    },
  }
}

/** Schlüssel einer Abfrage: Schema, SQL und Parameter. */
export const queryKey = (schema: string, sql: string, params?: unknown[]): string => `${schema}\u0000${sql}\u0000${params ? JSON.stringify(params) : ''}`
