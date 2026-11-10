import { useCallback, useEffect, useState } from 'react'
import { API_URL, getToken } from './auth'
import HoldButton from './HoldButton'
import { datenstandText } from './instance'
import { errorText, notifyError, notifySuccess } from './toast'

// Testumgebung: Stand prüfen und für Prod freigeben (core/backend/fmis_core/release.py).
// Der Host holt die Anfrage im Minutentakt ab und spielt sie auf Prod ein.

interface Stand {
  dev_sha: string
  prod_sha: string | null
  datenstand: string | null
  aktualisiert: string
  commits: { sha: string; titel: string }[]
}
interface Anfrage {
  sha: string
  von: string
  am: string
}
interface Letzte extends Anfrage {
  ergebnis: 'ok' | 'fehler' | 'laeuft'
  meldung?: string
  fertig?: string
}
interface ReleaseStatus {
  stand: Stand | null
  angefordert: Anfrage | null
  letzte: Letzte | null
}

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/admin/release`, {
    method,
    headers: { Authorization: `Bearer ${getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(b?.detail ?? `Fehler ${res.status}`)
  }
  return (await res.json()) as T
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '–')
const when = (iso: string | undefined) => (iso ? datenstandText(iso) : null)

export default function Release() {
  const [data, setData] = useState<ReleaseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    call<ReleaseStatus>('GET')
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch((e: unknown) => setError(errorText(e)))
  }, [])
  useEffect(() => {
    load()
    // während eine Freigabe läuft, nachschauen
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
  if (!data) return <p className="p-4 text-center text-sm text-gray-500">Lädt…</p>
  const { stand, angefordert, letzte } = data
  if (!stand) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Noch kein Stand vom Server gemeldet (tools/deploy/fmis-deploy.sh dev).</p>

  const same = stand.dev_sha === stand.prod_sha
  const pending = angefordert && angefordert.sha === stand.dev_sha
  const running = letzte?.ergebnis === 'laeuft'

  async function release() {
    try {
      await call('POST', { sha: stand!.dev_sha })
      notifySuccess('Freigabe angefordert — Prod wird in den nächsten Minuten aktualisiert')
      load()
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <section className="rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-500">Stand</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-gray-500">Testumgebung</dt>
          <dd className="font-mono">{short(stand.dev_sha)}</dd>
          <dt className="text-gray-500">Prod</dt>
          <dd className="font-mono">{short(stand.prod_sha)}</dd>
          <dt className="text-gray-500">Daten von Prod</dt>
          <dd>{datenstandText(stand.datenstand) ?? '–'}</dd>
        </dl>
      </section>

      <section className="rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-500">{same ? 'Prod ist auf diesem Stand' : `Neu gegenüber Prod (${stand.commits.length})`}</h2>
        {!same && (
          <ul className="mb-3 space-y-1">
            {stand.commits.map((c) => (
              <li key={c.sha} className="flex gap-2">
                <span className="shrink-0 font-mono text-xs text-gray-500">{short(c.sha)}</span>
                <span>{c.titel}</span>
              </li>
            ))}
          </ul>
        )}
        {!same &&
          (pending || running ? (
            <p className="rounded-lg bg-brand-50 p-2 text-brand-900">
              ⏳ Freigabe {running ? 'läuft' : 'angefordert'} ({angefordert?.von ?? letzte?.von}). Prod wird in den nächsten Minuten aktualisiert.
            </p>
          ) : (
            <>
              <HoldButton label={`Stand ${short(stand.dev_sha)} für Prod freigeben (gedrückt halten)`} onDone={() => void release()} />
              <p className="mt-1 text-xs text-gray-500">Vorher sichert der Server die Prod-Datenbank. Danach läuft Prod auf genau diesem Stand.</p>
            </>
          ))}
      </section>

      {letzte && letzte.ergebnis !== 'laeuft' && (
        <section className={`rounded-lg p-3 ${letzte.ergebnis === 'ok' ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}`}>
          <p className="font-semibold">
            Letzte Freigabe: {letzte.ergebnis === 'ok' ? '✅ eingespielt' : '❌ fehlgeschlagen'} — {short(letzte.sha)}, {letzte.von}
            {when(letzte.fertig) ? `, ${when(letzte.fertig)}` : ''}
          </p>
          {letzte.meldung && <p className="mt-1 text-xs">{letzte.meldung}</p>}
        </section>
      )}
    </div>
  )
}
