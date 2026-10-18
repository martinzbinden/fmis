import { useSyncExternalStore } from 'react'
import { dismissToast, getToasts, subscribeToasts } from './toast'

const STYLE = {
  error: 'bg-red-700 text-white',
  success: 'bg-green-700 text-white',
  info: 'bg-gray-800 text-white',
} as const

/** Einmal in der App einhängen (frontend/src/App.tsx). Über der unteren
 * Navigation, mit Abstand zum iPhone-Rand; Antippen schliesst. */
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts)
  if (toasts.length === 0) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-[2300] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          role={t.kind === 'error' ? 'alert' : 'status'}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto flex min-h-12 w-full max-w-md items-center gap-2 rounded-xl px-4 py-2 text-left text-sm font-medium shadow-lg ${STYLE[t.kind]}`}
        >
          <span aria-hidden>{t.kind === 'error' ? '⚠️' : t.kind === 'success' ? '✓' : 'ℹ️'}</span>
          <span className="flex-1">{t.text}</span>
          <span aria-hidden className="opacity-70">×</span>
        </button>
      ))}
    </div>
  )
}
