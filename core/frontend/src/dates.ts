// «Heute» immer in LOKALER Zeit (Europe/Zurich auf den Geräten).
// `new Date().toISOString().slice(0, 10)` ist das UTC-Datum und liegt
// zwischen Mitternacht und 01:00/02:00 einen Tag zurück — Einträge landeten
// dann auf gestern, «Stand am» und die Heute-Markierung zeigten gestern.
// Reine Datumsrechnungen (addDaysIso & Co.) bleiben bewusst in UTC.

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD des lokalen Kalendertags. */
export function localTodayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** YYYY-MM-DD des lokalen Kalendertags eines Zeitpunkts (ISO-Timestamp). */
export function localDateOf(ts: string | Date): string {
  return localTodayIso(ts instanceof Date ? ts : new Date(ts))
}
