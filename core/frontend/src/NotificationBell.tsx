import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Switch from './Switch'
import { markNotificationsRead, refreshNotifications, setNotifyEmail, useNotifications } from './notifications'
import { errorText, notifyError } from './toast'

const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Glocke in der Kopfzeile: Anzahl ungelesener Meldungen, Liste, E-Mail ein/aus (Profil). */
export default function NotificationBell() {
  const n = useNotifications()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // anderer Punkt im Menü gewählt: die Liste schliesst sich
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    void refreshNotifications()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  const unread = n?.unread ?? 0
  return (
    <div ref={box} className="sm:relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Benachrichtigungen"
        aria-label={unread ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'}
        className={`relative grid min-h-12 min-w-12 place-items-center rounded-full text-xl active:bg-gray-100 ${open ? 'bg-gray-200' : ''}`}
      >
        🔔
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>
      {open && (
        // füllt den ganzen Bildschirm unter der Kopfzeile (die Glocke bleibt sichtbar: nochmals antippen schliesst)
        <div role="dialog" aria-label="Benachrichtigungen" className="fixed inset-x-0 bottom-0 top-[calc(3.6rem+env(safe-area-inset-top,0px))] z-10 flex flex-col overflow-hidden bg-white lg:left-52">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <span className="text-lg font-bold text-gray-800">Benachrichtigungen</span>
            <span className="flex items-center gap-2">
              {unread > 0 && (
                <button type="button" className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm text-brand-700" onClick={() => void markNotificationsRead('all')}>
                  Alle gelesen
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="Benachrichtigungen schliessen" className="grid h-11 w-11 place-items-center rounded-full text-xl text-gray-600 active:bg-gray-100">
                ✕
              </button>
            </span>
          </div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto pb-24">
            {(n?.items ?? []).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`block w-full px-4 py-3 text-left text-base active:bg-gray-100 ${m.read ? 'text-gray-500' : 'bg-sky-50 text-gray-800'}`}
                  onClick={() => {
                    if (!m.read) void markNotificationsRead([m.id])
                    setOpen(false)
                    if (m.link) navigate(m.link)
                  }}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={m.read ? '' : 'font-semibold'}>{m.title}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{when(m.created_at)}</span>
                  </span>
                  {m.body && <span className="block text-xs">{m.body}</span>}
                </button>
              </li>
            ))}
            {n && n.items.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">Keine Benachrichtigungen.</li>}
            {!n && <li className="px-3 py-3 text-sm text-gray-500">Nur mit Verbindung zum Server.</li>}
          </ul>
          {n && (
            <div className="flex items-center justify-between gap-2 border-t bg-gray-50 px-4 py-3 pb-24 text-sm">
              <span className="text-gray-700">Auch per E-Mail</span>
              <Switch checked={n.notifyEmail} onChange={(v) => void setNotifyEmail(v).catch((e) => notifyError(errorText(e)))} label="Benachrichtigungen auch per E-Mail" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
