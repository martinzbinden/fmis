import { useRegisterSW } from 'virtual:pwa-register/react'

// Wie oft selbst nach einer neuen Version gefragt wird, solange die App
// offen ist. Der Browser prüft von sich aus nur, wenn `register()` erneut
// läuft (also bei einem vollen Neuladen) — eine als Homescreen-Icon
// geöffnete PWA bleibt aber oft tagelang im Hintergrund bestehen, statt
// neu geladen zu werden, wenn man sie wieder antippt.
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Hält den Service Worker aktuell und zeigt einen Hinweis, sobald eine neue
 * Version bereitsteht — mit explizitem "Jetzt laden" statt stillem
 * Neuladen, damit niemand mitten in einem Formular (z.B. Tageseintrag)
 * unterbrochen wird. */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => void registration.update()
      setInterval(check, CHECK_INTERVAL_MS)
      // Bestes Signal dafür, dass "das Smartphone die App wieder geöffnet
      // hat": der Tab/die App wird wieder sichtbar.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 bg-slate-800 px-4 py-3 text-sm text-white shadow-lg">
      <span>Neue Version verfügbar.</span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="shrink-0 rounded bg-brand-600 px-3 py-1.5 font-medium active:bg-brand-700"
      >
        Jetzt laden
      </button>
    </div>
  )
}
