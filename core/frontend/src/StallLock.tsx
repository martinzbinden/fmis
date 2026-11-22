import { useEffect, useState, useSyncExternalStore } from 'react'
import HoldButton from './HoldButton'
import { READER_FEEDBACK_EVENT, type ReaderFeedback } from './tagReader'
import AppIcon from './AppIcon'

// Sperre gegen Fehlberührungen (Stallmodus): 🔒 in der Kopfzeile legt eine Scheibe über die Seite. Die Seite bleibt
// sichtbar und arbeitet weiter (Lesegerät, Zähler), Antippen bewirkt nichts. Entsperren nur durch Halten (1 s).
// Der Fokus bleibt, wo er war: ein Lesegerät als Tastatur (HID) schreibt weiter ins Feld.

let locked = false
const listeners = new Set<() => void>()
const setLocked = (v: boolean) => {
  locked = v
  listeners.forEach((l) => l())
}
const useLocked = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => locked,
  )

/** 🔒 in der Kopfzeile (nur im Stallmodus). */
export function LockButton() {
  return (
    <button
      type="button"
      // Fokus nicht vom Eingabefeld wegnehmen (Lesegerät als Tastatur)
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => setLocked(true)}
      aria-label="Bildschirm sperren gegen Fehlberührungen"
      title="Sperren"
      className="grid min-h-12 min-w-10 place-items-center rounded-full text-xl active:bg-gray-100 sm:min-w-12"
    >
      <AppIcon icon="sperre" size={30} />
    </button>
  )
}

const TONE = { ok: 'bg-white text-gray-900', warn: 'bg-amber-100 text-amber-950', error: 'bg-red-100 text-red-900' } as const

/** Die Scheibe selbst (einmal in der App). */
export default function StallLock() {
  const on = useLocked()
  const [last, setLast] = useState<(ReaderFeedback & { reads: number }) | null>(null)
  useEffect(() => {
    const onFeedback = (e: Event) => setLast((e as CustomEvent<ReaderFeedback & { reads: number }>).detail)
    window.addEventListener(READER_FEEDBACK_EVENT, onFeedback)
    return () => window.removeEventListener(READER_FEEDBACK_EVENT, onFeedback)
  }, [])
  useEffect(() => {
    if (!on) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [on])
  if (!on) return null
  return (
    <div
      className="fixed inset-0 z-[2500] flex select-none flex-col justify-between bg-gray-900/25 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))]"
      onContextMenu={(e) => e.preventDefault()}
      // Antippen der Scheibe bewirkt nichts, auch der Fokus bleibt
      onPointerDown={(e) => e.preventDefault()}
      role="dialog"
      aria-modal="true"
      aria-label="Bildschirm gesperrt"
    >
      <div className="rounded-xl bg-gray-900/85 px-4 py-2 text-center text-base font-semibold text-white">🔒 Gesperrt – Seite läuft weiter</div>
      {last && (
        <div className={`rounded-xl px-4 py-3 text-center shadow-lg ${TONE[last.tone ?? 'ok']}`} aria-live="polite">
          <div className="text-sm">Letzte Lesung · {last.reads} gelesen</div>
          <div className="text-2xl font-bold">{last.text}</div>
        </div>
      )}
      <div className="mx-auto w-full max-w-sm">
        <HoldButton label="🔓 Zum Entsperren halten" ms={1000} onDone={() => setLocked(false)} />
      </div>
    </div>
  )
}
