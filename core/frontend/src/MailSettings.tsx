import { useCallback, useEffect, useState } from 'react'
import { API_URL, getToken } from './auth'
import { datenstandText } from './instance'
import { errorText, notifyError, notifySuccess } from './toast'

// Verwaltung → Mail: Postfach für FMIS (core/backend/fmis_core/mailbox.py). Das Passwort geht nur zum Server und
// kommt nie zurück (leer lassen = bisheriges behalten).

interface MailStatus {
  host: string
  port: number
  username: string
  has_password: boolean
  folder: string
  senders: string[]
  poll_minutes: number
  last_poll_at: string | null
  last_ok_at: string | null
  last_error: string | null
  background: boolean
  handlers: { name: string; label: string }[]
  recent: { handler: string; mail_date: string | null; sender: string; subject: string; saved: number; problems: string[]; processed_at: string }[]
}

async function call<T>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path = '', body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/admin/mail${path}`, {
      method,
      headers: { Authorization: `Bearer ${getToken()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Keine Verbindung zum Server.')
  }
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(b?.detail ?? `Fehler ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

const field = 'min-h-11 w-full rounded-lg border-2 border-gray-400 px-3 text-base focus:border-brand-700 focus:outline-none'
const when = (iso: string | null) => (iso ? datenstandText(iso) : '–')

export default function MailSettings() {
  const [data, setData] = useState<MailStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ host: '', port: '993', username: '', password: '', folder: 'INBOX', senders: '', poll_minutes: '30' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    call<MailStatus>('GET')
      .then((d) => {
        setData(d)
        setError(null)
        setDraft({ host: d.host, port: String(d.port), username: d.username, password: '', folder: d.folder, senders: d.senders.join('\n'), poll_minutes: String(d.poll_minutes) })
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])
  useEffect(load, [load])

  async function save() {
    setBusy(true)
    try {
      await call('PUT', '', {
        host: draft.host,
        port: Number(draft.port) || 993,
        username: draft.username,
        password: draft.password,
        folder: draft.folder,
        senders: draft.senders.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        poll_minutes: Number(draft.poll_minutes) || 30,
      })
      notifySuccess('Mail-Abruf gespeichert')
      load()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function pollNow() {
    setBusy(true)
    try {
      const r = await call<{ configured: boolean; mails?: number; saved?: number }>('POST', '/poll')
      notifySuccess(r.configured ? `Abgerufen: ${r.mails ?? 0} neue Mails, ${r.saved ?? 0} Einträge` : 'Noch nicht eingerichtet')
      load()
    } catch (e) {
      notifyError(errorText(e))
      load()
    } finally {
      setBusy(false)
    }
  }
  async function forgetPassword() {
    if (!window.confirm('Gespeichertes Passwort löschen? Der Abruf hört dann auf.')) return
    await call('DELETE', '/password').catch((e: unknown) => notifyError(errorText(e)))
    load()
  }

  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
  if (!data) return <p className="p-4 text-center text-sm text-gray-500">Lädt…</p>
  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }))

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">📬 E-Mail-Konto für FMIS</h2>
        <p className="text-sm text-gray-700">
          FMIS holt Mails aus diesem Postfach und gibt sie an die Module weiter ({data.handlers.map((h) => h.label).join(', ') || 'noch keine'}). Das Postfach wird nur gelesen. Das Passwort bleibt auf dem Server und wird nie
          angezeigt.
        </p>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <label className="text-sm font-medium text-gray-800">
            Server (IMAP)
            <input className={field} value={draft.host} onChange={set('host')} placeholder="z.B. imap.example.ch" autoComplete="off" />
          </label>
          <label className="text-sm font-medium text-gray-800">
            Port
            <input className={field} value={draft.port} onChange={set('port')} inputMode="numeric" />
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-800">
          Benutzer (Login des Postfachs)
          <input className={field} value={draft.username} onChange={set('username')} autoComplete="off" autoCapitalize="off" />
        </label>
        <label className="block text-sm font-medium text-gray-800">
          Passwort {data.has_password && <span className="font-normal text-green-800">(gespeichert – leer lassen zum Behalten)</span>}
          <input className={field} type="password" value={draft.password} onChange={set('password')} autoComplete="new-password" placeholder={data.has_password ? '••••••••' : ''} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium text-gray-800">
            Ordner
            <input className={field} value={draft.folder} onChange={set('folder')} />
          </label>
          <label className="text-sm font-medium text-gray-800">
            Abruf alle … Minuten
            <input className={field} value={draft.poll_minutes} onChange={set('poll_minutes')} inputMode="numeric" />
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-800">
          Erlaubte Absender (je Zeile eine Adresse oder «@domain», z.B. der Absender der FERTALYS-Mails und die eigene Domain für Weiterleitungen)
          <textarea className={`${field} py-2`} rows={3} value={draft.senders} onChange={set('senders')} placeholder={'absender@example.ch\n@example.org'} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
            Speichern
          </button>
          <button type="button" disabled={busy} onClick={() => void pollNow()} className="min-h-11 rounded-lg border-2 border-brand-700 bg-white px-4 font-semibold text-brand-800 disabled:opacity-50">
            Jetzt abrufen
          </button>
          {data.has_password && (
            <button type="button" onClick={() => void forgetPassword()} className="min-h-11 rounded-lg px-3 text-sm text-red-700">
              Passwort löschen
            </button>
          )}
        </div>
        <p className="text-xs text-gray-600">
          Letzter Abruf {when(data.last_poll_at)} · zuletzt erfolgreich {when(data.last_ok_at)}
          {!data.background && ' · Testumgebung: nur «Jetzt abrufen», kein Abruf im Hintergrund'}
        </p>
        {data.last_error && <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">Fehler: {data.last_error}</p>}
      </section>

      {data.recent.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-700">Zuletzt verarbeitet</h2>
          <ul className="divide-y text-sm">
            {data.recent.map((m, i) => (
              <li key={i} className="py-1.5">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate font-medium text-gray-900">{m.subject || '(ohne Betreff)'}</span>
                  <span className="shrink-0 text-gray-700">{m.saved} gespeichert</span>
                </div>
                <div className="text-xs text-gray-600">
                  {m.handler} · {m.sender} · {when(m.processed_at)}
                </div>
                {m.problems.map((p) => (
                  <div key={p} className="text-xs font-medium text-red-800">
                    ⚠ {p}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
