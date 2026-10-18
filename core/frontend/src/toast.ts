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

/** Fehler (Exception/unbekannt) → lesbarer Text. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
