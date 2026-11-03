// Kurze Hinweise statt alert(): blockieren nicht, bleiben lesbar und sagen,
// was passiert ist (Toaster.tsx zeigt sie an).

export type ToastKind = 'error' | 'success' | 'info'
export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const recent = new Map<string, number>()

function emit() {
  listeners.forEach((l) => l())
}

export function subscribeToasts(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getToasts(): Toast[] {
  return toasts
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function notify(kind: ToastKind, text: string, ttlMs?: number): void {
  // Gleiche Meldung nicht stapeln (z.B. mehrere Abfragen scheitern gleichzeitig)
  const now = Date.now()
  if (now - (recent.get(text) ?? 0) < 4000) return
  recent.set(text, now)
  const id = nextId++
  toasts = [...toasts.slice(-3), { id, kind, text }]
  emit()
  const ttl = ttlMs ?? (kind === 'error' ? 9000 : 2600)
  setTimeout(() => dismissToast(id), ttl)
}

export const notifyError = (text: string) => notify('error', text)
export const notifySuccess = (text: string) => notify('success', text)
export const notifyInfo = (text: string) => notify('info', text)

/** Spaltennamen in Fehlermeldungen → Wörter, die man auf dem Hof versteht. */
const COLUMN_LABELS: Record<string, string> = {
  ear_tag: 'Ohrmarke',
  animal_key: 'Tier',
  animal_id: 'Tier',
  lauf_nr: 'Laufnummer',
  name: 'Name',
  title: 'Titel',
  email: 'E-Mail',
  import_key: 'Import-Eintrag',
  entry_date: 'Datum',
  birth_date: 'Geburtsdatum',
  date: 'Datum',
}
const label = (col: string) => COLUMN_LABELS[col] ?? col

/** Tabellen, an denen beim Löschen noch Einträge hängen können. */
const TABLE_LABELS: Record<string, string> = {
  animal_journal: 'Journal',
  births: 'Geburten',
  birth_offspring: 'Geburten',
  matings: 'Belegungen',
  pregnancy_checks: 'Trächtigkeit',
  claw_exams: 'Klauen',
  claw_findings: 'Klauen',
  milk_tests: 'Milchproben',
  lactations: 'Laktationen',
  weighings: 'Wägungen',
  watchlist_entries: 'Merklisten',
  herd_members: 'Tiergruppen',
  group_memberships: 'Gruppen',
  journal_photos: 'Fotos',
  reminders: 'Pendenzen',
  treatment_templates: 'Behandlungsvorlagen',
  medications: 'Medikamente',
  plan_parcels: 'Parzellen',
  variants: 'Varianten',
}

/** Englische Datenbank- und Netzwerkfehler (PGlite/Postgres, fetch) auf Deutsch.
 * Gibt null, wenn die Meldung nicht erkannt wird. */
export function translateDbError(message: string, detail?: string): string | null {
  let m: RegExpExecArray | null
  if (/duplicate key value violates unique constraint/i.test(message)) {
    m = /Key \((.+?)\)=\((.*)\) already exists/.exec(detail ?? message)
    if (m) {
      const cols = m[1].split(',').map((c) => label(c.trim().replace(/"/g, '')))
      return `Gibt es schon: ${cols.join(' / ')} «${m[2]}» ist bereits erfasst.`
    }
    return 'Gibt es schon: ein gleicher Eintrag ist bereits erfasst.'
  }
  if ((m = /update or delete on table "(\w+)" violates foreign key constraint .* on table "(\w+)"/i.exec(message)))
    return `Kann nicht gelöscht werden: es hängen noch Einträge daran (${TABLE_LABELS[m[2]] ?? m[2]}).`
  if (/violates foreign key constraint/i.test(message))
    return 'Nicht gespeichert: der zugehörige Eintrag fehlt (vielleicht gelöscht oder noch nicht abgeglichen).'
  if ((m = /null value in column "(\w+)"/i.exec(message))) return `Angabe fehlt: ${label(m[1])}.`
  if ((m = /violates check constraint "(\w+)"/i.exec(message))) return `Ungültiger Wert (Prüfung ${m[1]}).`
  if ((m = /invalid input syntax for type (\w+)(?: precision)?: "(.*)"/i.exec(message))) {
    const kind = /^(integer|numeric|double|real|bigint|smallint)$/.test(m[1]) ? 'keine Zahl' : m[1] === 'date' || m[1].startsWith('timestamp') ? 'kein Datum' : `ungültig (${m[1]})`
    return `Ungültige Eingabe: «${m[2]}» ist ${kind}.`
  }
  if (/date\/time field value out of range|datetime field overflow/i.test(message)) return 'Ungültiges Datum.'
  if (/numeric field overflow|out of range for type/i.test(message)) return 'Zahl ist zu gross.'
  if ((m = /value too long for type character varying\((\d+)\)/i.exec(message))) return `Text ist zu lang (höchstens ${m[1]} Zeichen).`
  if ((m = /relation "(\w+)" does not exist/i.exec(message)))
    return `Datenablage noch nicht bereit (Tabelle ${m[1]} fehlt). Bitte Seite neu laden.`
  if (/^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|network error)$/i.test(message.trim()))
    return 'Keine Verbindung zum Server. Später nochmals versuchen.'
  return null
}

/** Fehler (Exception/unbekannt) → lesbarer, möglichst deutscher Text. */
export function errorText(err: unknown, fallback?: string): string {
  if (!(err instanceof Error)) {
    if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
      const e = err as { message: string; detail?: string }
      return translateDbError(e.message, e.detail) ?? e.message
    }
    return fallback ?? String(err)
  }
  return translateDbError(err.message, (err as Error & { detail?: string }).detail) ?? err.message
}
