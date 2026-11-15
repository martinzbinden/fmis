import { useEffect, useReducer, useState } from 'react'
import Modal from './Modal'
import { API_URL, getToken } from './auth'
import { allSyncClients, type SyncClient, type SyncStatus } from './sync'

// Status-Anzeige beim Sync-Punkt: Abgleich je Modul (Zustand, offene Änderungen, letzter Abgleich, Datenmenge),
// Dienste (Server, Datenbank), Speicher auf diesem Gerät, Programmversion. Alles in Worten, nie nur als Farbe.

interface ServerStatus {
  server_time: string
  started_at: string
  instanz: string | null
  db: { ok: boolean; ms?: number; size_bytes?: number | null; fehler?: string }
}
interface Version {
  commit: string | null
  commit_date: string | null
  build_time: string | null
}

/** Version der App, die gerade im Browser läuft (beim Bauen eingesetzt). */
export const APP_VERSION: Version = {
  commit: import.meta.env.VITE_FMIS_COMMIT || null,
  commit_date: import.meta.env.VITE_FMIS_COMMIT_DATE || null,
  build_time: import.meta.env.VITE_BUILD_TIME || null,
}

const STATUS_TEXT: Record<SyncStatus, { text: string; mark: string; cls: string }> = {
  synced: { text: 'in Ordnung', mark: '✓', cls: 'text-green-800' },
  syncing: { text: 'gleicht ab …', mark: '⟳', cls: 'text-amber-800' },
  offline: { text: 'offline', mark: '○', cls: 'text-gray-700' },
  error: { text: 'Fehler', mark: '✕', cls: 'text-red-700' },
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '–'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} kB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function fmtAgo(ms: number | null, now: number): string {
  if (ms == null) return 'seit dem Öffnen noch nicht'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 10) return 'gerade eben'
  if (s < 90) return `vor ${s} s`
  if (s < 3600) return `vor ${Math.round(s / 60)} min`
  return `vor ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
}

export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : null)

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-gray-600">{k}</dt>
      <dd className="text-right font-medium text-gray-900">{children}</dd>
    </div>
  )
}

function ModuleRow({ client, title, now }: { client: SyncClient; title: string; now: number }) {
  const s = client.getStats()
  const status = client.getSyncStatus()
  const st = STATUS_TEXT[status]
  const pending = client.getPendingCount()
  const error = client.getSyncError()
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-900">{title}</span>
        <span className={`font-semibold ${st.cls}`}>
          <span aria-hidden>{st.mark}</span> {st.text}
        </span>
      </div>
      <p className="text-sm text-gray-700">
        {pending > 0 ? <b className="text-amber-800">{pending} noch nicht gesendet · </b> : 'alles gesendet · '}
        {s.lastOkAt == null ? 'seit dem Öffnen der App noch nicht abgeglichen' : `letzter Abgleich ${fmtAgo(s.lastOkAt, now)}`}
        {s.lastDurationMs != null ? ` (${(s.lastDurationMs / 1000).toFixed(1)} s)` : ''}
      </p>
      <p className="text-sm text-gray-600">
        seit dem Öffnen: {s.rowsDown.toLocaleString('de-CH')} Zeilen geholt ({fmtBytes(s.bytesDown)}), {s.rowsUp.toLocaleString('de-CH')} gesendet ({fmtBytes(s.bytesUp)})
        {s.failures > 0 ? ` · ${s.failures} von ${s.runs} Abgleichen fehlgeschlagen` : ''}
      </p>
      {error && <p className="mt-0.5 rounded bg-red-50 p-1.5 text-sm text-red-800">{error}</p>}
    </li>
  )
}

export default function SyncStatusPanel({ onClose, titles }: { onClose: () => void; titles?: Record<string, string> }) {
  const clients = allSyncClients()
  const [, tick] = useReducer((x: number) => x + 1, 0)
  const [now, setNow] = useState(() => Date.now())
  const [server, setServer] = useState<{ data: ServerStatus | null; ms: number | null; error: string | null; loading: boolean }>({ data: null, ms: null, error: null, loading: true })
  const [live, setLive] = useState<Version | null>(null)
  const [storage, setStorage] = useState<{ usage: number | null; quota: number | null; persisted: boolean | null }>({ usage: null, quota: null, persisted: null })
  const [busy, setBusy] = useState(false)

  // Zustand der Clients mitverfolgen, Uhr für «vor … s»
  useEffect(() => {
    const offs = clients.map((c) => c.subscribeSyncStatus(tick))
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => {
      offs.forEach((off) => off())
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.length])

  async function check() {
    setServer((s) => ({ ...s, loading: true }))
    const t0 = performance.now()
    try {
      const res = await fetch(`${API_URL}/core/status`, { headers: { Authorization: `Bearer ${getToken()}` }, signal: 'timeout' in AbortSignal ? AbortSignal.timeout(10_000) : undefined })
      if (!res.ok) throw new Error(`Antwort ${res.status}`)
      const data = (await res.json()) as ServerStatus
      setServer({ data, ms: Math.round(performance.now() - t0), error: null, loading: false })
    } catch (e) {
      setServer({ data: null, ms: null, error: navigator.onLine ? `Server antwortet nicht (${e instanceof Error ? e.message : 'Fehler'})` : 'Dieses Gerät ist offline', loading: false })
    }
    try {
      const res = await fetch('/version.json', { cache: 'no-store' })
      const v = res.ok ? ((await res.json()) as Version) : null
      setLive(v && typeof v === 'object' && 'build_time' in v ? v : null)
    } catch {
      setLive(null)
    }
    try {
      const est = await navigator.storage?.estimate?.()
      const persisted = (await navigator.storage?.persisted?.()) ?? null
      setStorage({ usage: est?.usage ?? null, quota: est?.quota ?? null, persisted })
    } catch {
      // ältere Browser: keine Angabe
    }
    setNow(Date.now())
  }
  useEffect(() => {
    void check()
  }, [])

  /** Den Browser bitten, die Daten dieser App nicht bei Platzmangel zu löschen. */
  async function protect() {
    try {
      const ok = (await navigator.storage?.persist?.()) ?? false
      setStorage((s) => ({ ...s, persisted: ok }))
      if (!ok) setServer((s) => ({ ...s }))
    } catch {
      // Browser ohne diese Möglichkeit
    }
  }

  async function syncAll() {
    setBusy(true)
    try {
      await Promise.all(clients.map((c) => c.syncNow().catch(() => [])))
      await check()
    } finally {
      setBusy(false)
    }
  }

  const pendingTotal = clients.reduce((n, c) => n + c.getPendingCount(), 0)
  const anyError = clients.some((c) => c.getSyncStatus() === 'error')
  const allGood = !anyError && pendingTotal === 0 && !!server.data?.db.ok
  const newer = live && APP_VERSION.build_time && live.build_time && live.build_time !== APP_VERSION.build_time
  const h = 'mb-1 mt-3 text-sm font-bold text-gray-800'

  return (
    <Modal title="Status" onClose={onClose}>
      <p role="status" className={`rounded-lg p-2.5 font-semibold ${server.loading ? 'bg-gray-100 text-gray-800' : allGood ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
        {server.loading
          ? 'Prüfe …'
          : allGood
            ? '✓ Alles in Ordnung: Daten sind gesendet, Server und Datenbank antworten.'
            : server.error
              ? `⚠ ${server.error}. Deine Eingaben bleiben auf diesem Gerät und werden später gesendet.`
              : anyError
                ? '⚠ Ein Abgleich meldet einen Fehler (siehe unten).'
                : pendingTotal > 0
                  ? `⚠ ${pendingTotal} ${pendingTotal === 1 ? 'Änderung ist' : 'Änderungen sind'} noch nicht auf dem Server.`
                  : '⚠ Die Datenbank des Servers antwortet nicht.'}
      </p>

      <h3 className={h}>Abgleich je Modul</h3>
      {clients.length === 0 ? (
        <p className="text-sm text-gray-600">Noch kein Modul geöffnet.</p>
      ) : (
        <ul className="divide-y">
          {clients.map((c) => {
            const key = c.getStats().moduleKey
            return <ModuleRow key={key} client={c} title={titles?.[key] ?? key} now={now} />
          })}
        </ul>
      )}

      <h3 className={h}>Dienste</h3>
      <dl className="text-sm">
        <Row k="Server">{server.loading ? '…' : server.data ? `✓ antwortet in ${server.ms} ms` : '✕ nicht erreichbar'}</Row>
        <Row k="Datenbank">
          {server.loading ? '…' : !server.data ? '–' : server.data.db.ok ? `✓ in Ordnung (${server.data.db.ms} ms), ${fmtBytes(server.data.db.size_bytes)}` : `✕ Fehler (${server.data.db.fehler ?? '?'})`}
        </Row>
        {server.data && <Row k="Server läuft seit">{fmtStamp(server.data.started_at)}</Row>}
        {server.data?.instanz && <Row k="Instanz">{server.data.instanz === 'dev' ? 'Testumgebung' : server.data.instanz}</Row>}
        <Row k="Netz dieses Geräts">{navigator.onLine ? '✓ online' : '○ offline'}</Row>
      </dl>

      <h3 className={h}>Daten auf diesem Gerät</h3>
      <dl className="text-sm">
        <Row k="Belegter Speicher">
          {storage.usage != null ? `${fmtBytes(storage.usage)}${storage.quota ? ` von ${fmtBytes(storage.quota)} (${Math.max(0.1, (storage.usage / storage.quota) * 100).toFixed(1)} %)` : ''}` : 'keine Angabe'}
        </Row>
        <Row k="Vor dem Aufräumen geschützt">
          {storage.persisted == null ? (
            'keine Angabe'
          ) : storage.persisted ? (
            '✓ ja'
          ) : (
            <span>
              nein{' '}
              <button type="button" onClick={() => void protect()} className="ml-1 min-h-10 rounded-lg border border-gray-400 bg-white px-2.5 font-semibold text-gray-800">
                Schützen
              </button>
            </span>
          )}
        </Row>
        {storage.persisted === false && (
          <p className="text-xs text-gray-600">Ohne Schutz darf der Browser die Daten auf diesem Gerät bei Platzmangel löschen. Was schon gesendet ist, liegt sicher auf dem Server; nur noch nicht Gesendetes ginge verloren.</p>
        )}
      </dl>

      <h3 className={h}>Programmversion</h3>
      <dl className="text-sm">
        <Row k="Diese App">
          {short(APP_VERSION.commit) ? (
            <>
              <code className="rounded bg-gray-100 px-1">{short(APP_VERSION.commit)}</code> vom {fmtStamp(APP_VERSION.commit_date)}
            </>
          ) : (
            'ohne Commit-Angabe'
          )}
        </Row>
        <Row k="Gebaut am">{fmtStamp(APP_VERSION.build_time)}</Row>
        {newer && (
          <div className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
            Auf dem Server liegt eine neuere Fassung{short(live?.commit) ? ` (${short(live?.commit)}, ${fmtStamp(live?.commit_date)})` : ` (gebaut ${fmtStamp(live?.build_time)})`}.
            <button type="button" onClick={() => window.location.reload()} className="ml-2 min-h-10 rounded-lg border border-amber-600 bg-white px-3 font-semibold text-amber-900">
              Neu laden
            </button>
          </div>
        )}
      </dl>

      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void syncAll()} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:bg-gray-400">
          {busy ? 'Gleiche ab …' : 'Jetzt abgleichen und prüfen'}
        </button>
        <button type="button" onClick={onClose} className="min-h-12 rounded-lg border border-gray-300 px-4 font-medium text-gray-800">
          Schliessen
        </button>
      </div>
    </Modal>
  )
}
