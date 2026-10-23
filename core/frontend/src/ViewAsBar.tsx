import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchUserView, listUsers, type AdminUser } from './admin'
import { useRealUser } from './AuthContext'
import { errorText, notify, notifyError } from './toast'
import { expireViewAs, startViewAs, stopViewAs, touchViewAs, useViewAs, VIEW_AS_IDLE_MS } from './viewAs'

/** Roter Balken ganz oben, solange man die App mit den Rechten eines anderen
 * Nutzers sieht — mit Wechsel zu einem anderen Nutzer und Rückweg. Nach 20
 * Minuten ohne Bedienung kehrt die eigene Ansicht automatisch zurück. */
export default function ViewAsBar() {
  const view = useViewAs()
  const real = useRealUser()
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[]>([])
  const active = view != null
  const bar = useRef<HTMLDivElement>(null)

  // Höhe des Balkens an die Seite melden (index.css schiebt Kopfzeilen darunter);
  // auf schmalen Geräten bricht der Balken in zwei Zeilen um.
  useEffect(() => {
    const el = bar.current
    if (!active || !el) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--viewas-h', `${el.offsetHeight}px`)
    apply()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--viewas-h')
    }
  }, [active])

  // Bedienung melden, Ablauf prüfen (auch beim Zurückkehren in die App)
  useEffect(() => {
    if (!active) return
    const ping = () => touchViewAs()
    const check = () => {
      if (expireViewAs()) notify('info', `Zurück in deiner Ansicht (${VIEW_AS_IDLE_MS / 60000} Minuten ohne Bedienung).`)
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, ping, { passive: true, capture: true }))
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, 15_000)
    check()
    return () => {
      events.forEach((e) => window.removeEventListener(e, ping, { capture: true }))
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    let alive = true
    listUsers()
      .then((u) => alive && setUsers(u))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [active])

  if (!view) return null
  const others = users
    .filter((u) => u.status === 'active' && u.role_id && u.email.toLowerCase() !== view.email.toLowerCase() && u.email.toLowerCase() !== (real?.email ?? '').toLowerCase())
    .sort((a, b) => a.email.localeCompare(b.email))

  async function switchTo(id: string) {
    if (!id) return
    try {
      startViewAs(await fetchUserView(id))
      navigate('/dashboard')
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  return (
    <div
      ref={bar}
      role="status"
      className="fixed inset-x-0 top-0 z-[3000] flex flex-wrap items-center gap-x-2 gap-y-1 bg-red-600 px-3 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top,0px))] text-xs font-semibold text-white"
    >
      <span className="min-w-0 basis-full break-all sm:basis-0 sm:flex-1 sm:truncate">
        👁 Ansicht von {view.email}
        {view.role ? ` (${view.role})` : ''}
      </span>
      {others.length > 0 && (
        <select
          aria-label="Andere Ansicht"
          value=""
          onChange={(e) => void switchTo(e.target.value)}
          className="min-w-0 flex-1 rounded bg-red-700 px-1 py-1.5 text-xs text-white sm:max-w-[10rem] sm:flex-none"
        >
          <option value="">andere Ansicht…</option>
          {others.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => {
          stopViewAs()
          navigate('/dashboard')
        }}
        className="ml-auto shrink-0 rounded bg-white px-3 py-1.5 text-xs font-bold text-red-700"
      >
        Meine Ansicht
      </button>
    </div>
  )
}
