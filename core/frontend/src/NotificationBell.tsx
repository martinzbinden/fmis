import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SidePanel, { PanelButton } from './SidePanel'
import Switch from './Switch'
import { closePanel, useOpenPanel } from './headerPanel'
import { markNotificationsRead, refreshNotifications, setNotifyEmail, useNotifications } from './notifications'
import { errorText, notifyError } from './toast'
import AppIcon from './AppIcon'

const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()}.${d.getMonth() + 1}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Glocke in der Kopfzeile: Anzahl ungelesener Meldungen; öffnet das Seitenfenster (NotificationsPanel). */
export default function NotificationBell() {
  const n = useNotifications()
  const unread = n?.unread ?? 0
  return (
    <PanelButton
      panel="benachrichtigungen"
      label={unread ? `Benachrichtigungen, ${unread} ungelesen` : 'Benachrichtigungen'}
      badge={
        unread > 0 ? (
          <span aria-hidden className="absolute right-1 top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : undefined
      }
    >
      <AppIcon icon="glocke" size={30} />
    </PanelButton>
  )
}

/** Liste der Meldungen im Seitenfenster, E-Mail ein/aus. */
export function NotificationsPanel() {
  const n = useNotifications()
  const navigate = useNavigate()
  const open = useOpenPanel() === 'benachrichtigungen'
  useEffect(() => {
    if (open) void refreshNotifications()
  }, [open])
  const unread = n?.unread ?? 0
  return (
    <SidePanel
      panel="benachrichtigungen"
      title="Benachrichtigungen"
      actions={
        unread > 0 ? (
          <button type="button" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-brand-700" onClick={() => void markNotificationsRead('all')}>
            Alle gelesen
          </button>
        ) : undefined
      }
    >
      <ul className="-mx-4 -mt-4 divide-y bg-white">
        {(n?.items ?? []).map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className={`block w-full px-4 py-3 text-left text-base active:bg-gray-100 ${m.read ? 'text-gray-600' : 'bg-sky-50 text-gray-800'}`}
              onClick={() => {
                if (!m.read) void markNotificationsRead([m.id])
                closePanel('benachrichtigungen')
                if (m.link) navigate(m.link)
              }}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className={m.read ? '' : 'font-semibold'}>
                  {!m.read && <span className="sr-only">Ungelesen: </span>}
                  {m.title}
                </span>
                <span className="shrink-0 text-xs text-gray-600">{when(m.created_at)}</span>
              </span>
              {m.body && <span className="block text-sm">{m.body}</span>}
            </button>
          </li>
        ))}
        {n && n.items.length === 0 && <li className="px-4 py-3 text-sm text-gray-600">Keine Benachrichtigungen.</li>}
        {!n && <li className="px-4 py-3 text-sm text-gray-600">Nur mit Verbindung zum Server.</li>}
      </ul>
      {n && (
        <div className="mt-4 flex items-center justify-between gap-2 text-sm">
          <span className="text-gray-700">Auch per E-Mail</span>
          <Switch checked={n.notifyEmail} onChange={(v) => void setNotifyEmail(v).catch((e) => notifyError(errorText(e)))} label="Benachrichtigungen auch per E-Mail" />
        </div>
      )}
    </SidePanel>
  )
}
