import { useEffect, useRef, useState } from 'react'
import { API_URL, getToken } from '@fmis/core/auth'

interface MelkEintrag {
  ear_tag: string
  matched: boolean
  name: string | null
  position: number
}

/**
 * Live-Melkliste: zeigt jede beim Melken gescannte Ohrmarke in der
 * Reihenfolge des Scans (der Leser liefert keine Standplatz-/Kanalnummer —
 * "nur zeitliche Reihenfolge", siehe project_apr600_ear_tag_reader Memory).
 * Rein transient, es wird nichts gespeichert — die Liste existiert nur für
 * die Dauer der Verbindung.
 */
export default function Melken({ moduleKey }: { moduleKey: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [connected, setConnected] = useState(false)
  const [eintraege, setEintraege] = useState<MelkEintrag[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/${moduleKey}/reader/status`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((res) => res.json())
      .then((data: { enabled: boolean }) => setEnabled(data.enabled))
      .catch(() => setEnabled(false))
  }, [moduleKey])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function verbinden() {
    setError(null)
    setEintraege([])
    const controller = new AbortController()
    abortRef.current = controller
    setConnected(true)
    try {
      const res = await fetch(`${API_URL}/${moduleKey}/reader/live`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`Verbindung fehlgeschlagen (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const data = JSON.parse(line.slice('data: '.length))
          if (data.error) {
            setError(data.error)
            continue
          }
          setEintraege((prev) => [...prev, data as MelkEintrag])
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen')
      }
    } finally {
      setConnected(false)
    }
  }

  function trennen() {
    abortRef.current?.abort()
    setConnected(false)
  }

  if (enabled === null) {
    return <div className="p-4 text-center text-gray-400">Lädt…</div>
  }

  if (!enabled) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p>Der Ohrmarkenleser ist für diese Instanz nicht aktiviert.</p>
        <p className="mt-1 text-sm">Siehe Verwaltung → Module.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-800">Melken</h1>
        {connected ? (
          <button
            type="button"
            onClick={trennen}
            className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700"
          >
            Trennen
          </button>
        ) : (
          <button
            type="button"
            onClick={verbinden}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            Leser verbinden
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {eintraege.length === 0 ? (
        <p className="text-center text-sm text-gray-400">
          {connected ? 'Warte auf die erste Ohrmarke…' : 'Noch keine Sitzung.'}
        </p>
      ) : (
        <ol className="space-y-1">
          {eintraege.map((e) => (
            <li
              key={e.ear_tag}
              className="flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm"
            >
              <span className="w-6 text-right font-mono text-sm text-gray-400">{e.position}</span>
              <div className="flex-1">
                <div className="font-medium text-gray-800">{e.name ?? e.ear_tag}</div>
                {e.name && <div className="text-xs text-gray-500">{e.ear_tag}</div>}
              </div>
              {!e.matched && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  unbekannt
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
