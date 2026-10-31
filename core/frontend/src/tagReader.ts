import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, getToken } from './auth'
import { animalKey } from './earTag'

// Zentrale Leser-Funktion (APR600 über den Server, core/backend/fmis_core/reader_scan.py)
// für alle Stellen, an denen Tiernummern eingegeben werden. Das Formular bekommt jede
// Lesung über onRead und entscheidet selbst, was damit passiert (Tier wählen, in eine
// Liste aufnehmen, Ohrmarke eintragen). Darstellung: TagReaderButton.tsx.
//
// Doppelte Lesungen:
// - Das Gerät meldet dieselbe Marke beim Festhalten mehrmals → innert BOUNCE_MS still verworfen.
// - Ob eine Lesung im Zusammenhang doppelt ist (schon in der Liste, im Durchgang schon
//   erfasst), sagt das Formular über `duplicate` — so zählt ein Tier, das wieder aus der
//   Liste gelöscht wurde, beim nächsten Lesen wieder. Orte ohne eigene Liste können mit
//   `rememberSeen` den Leser selbst merken lassen; ein Wechsel von `context` (neue Gruppe,
//   neuer Durchgang) setzt dieses Gedächtnis zurück.
// - Ignorierte Lesungen lassen sich einzeln «trotzdem übernehmen», oder für die Sitzung
//   «Doppelte zulassen».

export interface TagRead {
  /** Rohform vom Gerät, z.B. CH000021728063 */
  tag: string
  /** anzeigbare Ohrmarke (bei Schafen die TVD-Kurzform CH21728063) */
  earTag: string
  /** Vergleichsschlüssel wie animalKey(animals.ear_tag) */
  key: string | null
}

export type ReaderTone = 'ok' | 'warn' | 'error'
export interface ReaderFeedback {
  text: string
  tone?: ReaderTone
}

export interface TagReaderOptions {
  /** Modul der Seite (bestimmt das Lesegerät); leer = kein Leser an dieser Stelle */
  moduleKey: string
  /** Lesung verarbeiten. Rückgabe = Meldung im Leser-Feld (Text = ok). */
  onRead: (read: TagRead, info: { forced: boolean }) => ReaderFeedback | string | void
  /** Grund, falls die Lesung im aktuellen Zusammenhang doppelt ist (sonst null). */
  duplicate?: (read: TagRead) => string | null | undefined | false
  /** Wechselt der Zusammenhang, vergisst der Leser die schon gelesenen Marken. */
  context?: string
  /** Gelesene Marken selbst merken (für Orte ohne eigene Liste). */
  rememberSeen?: boolean
}

export type ReaderPhase = 'off' | 'connecting' | 'ready' | 'error'

export interface TagReader {
  available: boolean
  on: boolean
  setOn: (on: boolean) => void
  phase: ReaderPhase
  /** Leser-Meldung (Verbindung) bzw. Ergebnis der letzten Lesung */
  message: ReaderFeedback | null
  reads: number
  ignored: { read: TagRead; reason: string } | null
  /** zuletzt ignorierte Lesung doch übernehmen */
  takeIgnored: () => void
  allowDuplicates: boolean
  setAllowDuplicates: (v: boolean) => void
}

const BOUNCE_MS = 5000

const availability = new Map<string, Promise<boolean>>()
function readerAvailable(moduleKey: string): Promise<boolean> {
  let p = availability.get(moduleKey)
  if (!p) {
    p = fetch(`${API_URL}/core/reader/status?module=${encodeURIComponent(moduleKey)}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled: boolean }>) : { enabled: false }))
      .then((r) => r.enabled)
      .catch(() => {
        availability.delete(moduleKey) // offline: beim nächsten Mal neu fragen
        return false
      })
    availability.set(moduleKey, p)
  }
  return p
}

/** Lesung → Tier aus einer Liste (Vergleich über animalKey, Kurz- und Langform). */
export function matchRead<T extends { ear_tag: string }>(read: Pick<TagRead, 'key'>, animals: readonly T[]): T | undefined {
  if (!read.key) return undefined
  return animals.find((a) => animalKey(a.ear_tag) === read.key)
}

/** Ziffern, die auf der Marke stehen (Schafe 8, Rinder 9) — z.B. für Nummernfelder. */
export function readDigits(read: Pick<TagRead, 'earTag'>): string {
  const key = animalKey(read.earTag) ?? read.earTag
  const cattle = /^CH120(\d{9})$/.exec(key)
  if (cattle) return cattle[1]
  return key.replace(/\D/g, '')
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // ohne Vibration
  }
}

export function useTagReader(opts: TagReaderOptions): TagReader {
  const { moduleKey, context, rememberSeen = false } = opts
  const [available, setAvailable] = useState(false)
  const [on, setOn] = useState(false)
  const [phase, setPhase] = useState<ReaderPhase>('off')
  const [message, setMessage] = useState<ReaderFeedback | null>(null)
  const [reads, setReads] = useState(0)
  const [ignored, setIgnored] = useState<{ read: TagRead; reason: string } | null>(null)
  const [allowDuplicates, setAllowDuplicates] = useState(false)

  const optsRef = useRef(opts)
  optsRef.current = opts
  const allowRef = useRef(allowDuplicates)
  allowRef.current = allowDuplicates
  const seen = useRef(new Set<string>())
  const lastRaw = useRef<{ tag: string; at: number } | null>(null)

  useEffect(() => {
    let alive = true
    if (!moduleKey) return // Leser an dieser Stelle nicht vorgesehen
    void readerAvailable(moduleKey).then((ok) => alive && setAvailable(ok))
    return () => {
      alive = false
    }
  }, [moduleKey])

  useEffect(() => {
    seen.current = new Set()
    setIgnored(null)
  }, [context])

  const deliver = useCallback((read: TagRead, forced: boolean) => {
    const result = optsRef.current.onRead(read, { forced })
    if (rememberSeen && read.key) seen.current.add(read.key)
    setIgnored(null)
    setReads((n) => n + 1)
    const fb: ReaderFeedback = typeof result === 'string' ? { text: result, tone: 'ok' } : (result ?? { text: `Gelesen: ${read.earTag}`, tone: 'ok' })
    setMessage(fb)
    vibrate(fb.tone === 'error' ? [40, 80, 40] : 60)
  }, [rememberSeen])

  const handle = useCallback((read: TagRead) => {
    const now = Date.now()
    if (lastRaw.current && lastRaw.current.tag === read.tag && now - lastRaw.current.at < BOUNCE_MS) return
    lastRaw.current = { tag: read.tag, at: now }
    if (!allowRef.current) {
      const reason = optsRef.current.duplicate?.(read) || (rememberSeen && read.key && seen.current.has(read.key) ? 'schon gelesen' : null)
      if (reason) {
        setIgnored({ read, reason })
        setMessage({ text: `${read.earTag}: ${reason} – ignoriert`, tone: 'warn' })
        vibrate([40, 80, 40])
        return
      }
    }
    deliver(read, false)
  }, [deliver, rememberSeen])

  useEffect(() => {
    if (!on) {
      setPhase((p) => (p === 'error' ? p : 'off'))
      return
    }
    const controller = new AbortController()
    setPhase('connecting')
    setMessage({ text: 'Verbinde mit dem Lesegerät …', tone: 'ok' })
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/core/reader/scan?module=${encodeURIComponent(moduleKey)}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail
          throw new Error(detail ?? `Lesegerät nicht verfügbar (${res.status})`)
        }
        const body = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (true) {
          const { done, value } = await body.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            const ev = JSON.parse(line.slice(6)) as { ready?: boolean; error?: string; closed?: boolean; tag?: string; ear_tag?: string }
            if (ev.ready) {
              setPhase('ready')
              setMessage({ text: 'Bereit: Ohrmarke lesen', tone: 'ok' })
            }
            if (ev.error) throw new Error(ev.error)
            if (ev.tag) {
              const earTag = ev.ear_tag ?? ev.tag
              handle({ tag: ev.tag, earTag, key: animalKey(earTag) })
            }
          }
        }
        throw new Error('Verbindung zum Lesegerät beendet')
      } catch (e) {
        if (controller.signal.aborted) return
        setPhase('error')
        setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' })
        setOn(false)
      }
    })()
    return () => controller.abort()
  }, [on, moduleKey, handle])

  const takeIgnored = useCallback(() => {
    if (ignored) deliver(ignored.read, true)
  }, [ignored, deliver])

  const setOnPublic = useCallback((v: boolean) => {
    setOn(v)
    if (v) {
      setReads(0)
      setIgnored(null)
    } else {
      setPhase('off')
      setMessage(null)
    }
  }, [])

  return { available, on, setOn: setOnPublic, phase, message, reads, ignored, takeIgnored, allowDuplicates, setAllowDuplicates }
}
