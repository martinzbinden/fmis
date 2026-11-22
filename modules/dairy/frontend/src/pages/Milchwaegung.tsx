import { isDrySql } from '../lib/dryOff'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken } from '@fmis/core/auth'
import AnimalOption from '@fmis/core/AnimalOption'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { useDb } from '@fmis/core/DbContext'
import { upsertRow, softDeleteRow, notifyDataChanged } from '../db/write'
import { SYNC_TABLES } from '../db/tables'
import { getDairySyncClient } from '../db/sync'
import { fmtDate, fmtDateTime, isoDate } from '../lib/format'
import { speciesOf, speciesTerms } from '../lib/species'
import { usePageSettings } from '@fmis/core/pageSettings'
import Modal from '@fmis/core/Modal'
import { readMilkingSettings, roundKg, saveMilkingSettings, useMilkingSettings, type MilkingSettings } from '../lib/milkingSettings'
import type { Animal, MilkingBank, MilkingSlot } from '../types'
import { earTagProblem, shortEarTag } from '@fmis/core/earTag'
import { inTransaction } from '../db/transaction'
import { notSupersededSql } from '../lib/journal'
import { MILK_UNTIL_SQL } from '../lib/treatments'
import NumberInput from '@fmis/core/NumberInput'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { animalProvider, refreshHerdData } from '@fmis/core/animals'
import { loadHerdData, memberAt, moveAnimals, type HerdData } from '@fmis/tiere/lib/herds'

/** Manuell dürfen ausnahmsweise so viele Tiere über die Plätze der Bank hinaus aufgenommen werden. */
const MANUAL_EXTRA = 2
/** Abruf neuer Lesungen vom Gerät, solange die offene Bank freie Plätze hat (ohne Live-Verbindung). */
const AUTO_FETCH_MS = 10_000

interface SessionState {
  active: boolean
  session_date: string | null
  capacity: number
  current_bank_id: string | null
  bank_number: number
  reads: number
  last_read_at: string | null
  last_error: string | null
  started_by: string | null
  handshake: string | null
  last_ignored: string | null
  host: string | null
  port: number | null
  connected_since: string | null
  pings: number
  pongs: number
  last_pong_at: string | null
  rtt_ms: number | null
  noise_bytes: number
  frames: number
}

/** Verbindungsqualität aus Keep-alive-Antworten: Alter der letzten Antwort und Umlaufzeit.
 * (Eine Funksignalstärke liefert das Protokoll nicht.) */
function quality(s: SessionState, now: number): { label: string; color: string } {
  if (!s.active || !s.handshake) return { label: '–', color: 'text-gray-500' }
  if (s.pings === 0) return { label: 'noch kein Keep-alive', color: 'text-gray-500' }
  const age = s.last_pong_at ? (now - new Date(s.last_pong_at).getTime()) / 1000 : Infinity
  if (age > 65) return { label: `keine Antwort seit ${Number.isFinite(age) ? Math.round(age) + ' s' : 'Beginn'}`, color: 'text-red-600' }
  if ((s.rtt_ms ?? 0) > 1500) return { label: `träge (${Math.round(s.rtt_ms!)} ms)`, color: 'text-amber-600' }
  if ((s.rtt_ms ?? 0) > 300) return { label: `mässig (${Math.round(s.rtt_ms!)} ms)`, color: 'text-amber-600' }
  return { label: `gut (${s.rtt_ms != null ? Math.round(s.rtt_ms) + ' ms' : 'ok'})`, color: 'text-green-600' }
}

interface ReaderEvent {
  seq: number
  kind: 'milking_banks' | 'milking_slots'
  row: Record<string, unknown>
}

/** Zeile aus einem SSE-Event direkt in pglite eintragen — dieselbe
 * Last-write-wins-Regel wie der Sync-Pull, der dieselbe Zeile später
 * nochmals bringt (dann ein No-op). */
async function applyReaderEvent(pg: PGlite, ev: ReaderEvent): Promise<void> {
  const columns = SYNC_TABLES[ev.kind] as readonly string[]
  const colList = columns.map((c) => `"${c}"`).join(', ')
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  const setClause = columns.filter((c) => c !== 'id').map((c) => `"${c}" = excluded."${c}"`).join(', ')
  await pg.query(
    `insert into "${ev.kind}" (${colList}) values (${placeholders})
     on conflict (id) do update set ${setClause} where "${ev.kind}".updated_at < excluded.updated_at`,
    columns.map((c) => ev.row[c] ?? null),
  )
}

interface SlotRow extends MilkingSlot {
  animal: Animal | null
  /** Letzter Tag einer offenen Milch-Absetzfrist (Tierjournal, Behandlung). */
  withdrawalUntil: string | null
  /** letzte Geburt des Tiers (für die Tage in Laktation) */
  lastBirth: string | null
}

interface BankWithSlots {
  bank: MilkingBank
  slots: SlotRow[]
}

async function loadBanks(pg: PGlite, date: string): Promise<BankWithSlots[]> {
  const { rows: banks } = await pg.query<MilkingBank>(
    'select * from milking_banks where session_date = $1 and deleted_at is null order by bank_number',
    [date],
  )
  if (banks.length === 0) return []
  const { rows: slots } = await pg.query<
    MilkingSlot & { a_id: string | null; a_name: string | null; a_lauf_nr: string | null; a_ear_tag: string | null; withdrawal_until: unknown; last_birth: unknown }
  >(
    `select s.*, a.id as a_id, a.name as a_name, a.lauf_nr as a_lauf_nr, a.ear_tag as a_ear_tag,
       (select max(${MILK_UNTIL_SQL}) from animal_journal j
         where j.animal_id = s.animal_id and j.deleted_at is null and ${notSupersededSql('j')}) as withdrawal_until,
       (select max(b.birth_date) from births b where b.dam_id = s.animal_id and b.deleted_at is null) as last_birth
     from milking_slots s left join animals a on a.id = s.animal_id
     where s.bank_id = any($1) and s.deleted_at is null order by s.position`,
    [banks.map((b) => b.id)],
  )
  return banks.map((bank) => ({
    bank,
    slots: slots
      .filter((s) => s.bank_id === bank.id)
      .map((s) => ({
        ...s,
        animal: s.a_id ? ({ id: s.a_id, name: s.a_name, lauf_nr: s.a_lauf_nr, ear_tag: s.a_ear_tag } as Animal) : null,
        withdrawalUntil: isoDate(s.withdrawal_until),
        lastBirth: isoDate(s.last_birth),
      })),
  }))
}

// Frist: sonst bleibt bei hängender Verbindung der automatische Abruf für immer stehen (er wartet auf die Antwort)
const API_TIMEOUT_MS = 45_000

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(API_TIMEOUT_MS) : undefined
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  }).catch((err: unknown) => {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new Error(`keine Antwort innert ${API_TIMEOUT_MS / 1000} s`)
    throw err
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(data?.detail ?? `Fehler (${res.status})`)
  }
  return (await res.json()) as T
}

/**
 * Milchwägung: die Tiere laufen der Reihe nach am Lesegerät vorbei, der
 * Server (backend/app/reader.py) schreibt jede Lesung als Slot in die
 * offene Bank (Melkstand-Durchgang, z.B. 12 Plätze). Diese Seite zeigt die
 * Bänke des Tages aus pglite, lauscht per SSE auf Änderungen und stösst
 * dann sofort einen Sync-Pull an. Gewogen-Häkchen, Notizen und Umsortieren
 * schreibt der Client per Sync.
 */
export default function Milchwaegung({ moduleKey }: { moduleKey: string }) {
  const terms = speciesTerms(moduleKey)
  const pg = useDb()
  const syncClient = getDairySyncClient(moduleKey)
  const canWrite = useHasPermission(`${moduleKey}:milk:write`)
  // Lokales Datum (nicht UTC wie todayIso) — beim Abendmelken sonst falscher Tag.
  const [date, setDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const { data, refresh } = useQuery((db) => loadBanks(db, date), [date])
  const [readerEnabled, setReaderEnabled] = useState<boolean | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const species = speciesOf(moduleKey)
  const milking = useMilkingSettings(moduleKey, species)
  const capacity = milking.capacity
  // Einstellungen im Zahnrad-Menü (Schrittweite, Sprung beim Gedrückthalten, Plätze je Bank)
  usePageSettings({ title: 'Milchwägung', render: () => <MilkingSettingsPanel moduleKey={moduleKey} species={species} /> }, [moduleKey, species])
  const [editDate, setEditDate] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const bankRef = useRef<HTMLElement | null>(null)
  const scrolledToBank = useRef(false)
  const [manualInput, setManualInput] = useState('')
  // Platz in der offenen Bank für die manuelle Aufnahme (leer = nächster freier): für Tiere, deren Ohrmarke nicht gelesen wurde
  const [manualPlace, setManualPlace] = useState('')
  // nach dem Aufnehmen bleibt der Cursor im Feld für das nächste Tier
  const manualRef = useRef<HTMLInputElement>(null)
  // Zahlentastatur (Laufnummer, Ohrmarke); «ABC» für Namen
  const [abc, setAbc] = useState(false)
  const [suggestIdx, setSuggestIdx] = useState(0)
  const [suggestOpen, setSuggestOpen] = useState(false)
  // Alle aktiven, nicht trockengestellten Tiere für die Vorschlagsliste
  // (Laufnummer / Ohrmarke / Name) — siehe lib/dryOff.ts
  const { data: animalsData } = useQuery(
    (db) =>
      db
        .query<Animal>(
          `select * from animals a where a.deleted_at is null and a.status = 'aktiv' and not ${isDrySql('a')} order by a.lauf_nr nulls last, a.ear_tag`,
        )
        .then((r) => r.rows),
    [],
  )
  // Seitenwähler: gewählte Bank des Tages; null = der jeweils neuesten folgen (offene Bank)
  const [pickedBankId, setPickedBankId] = useState<string | null>(null)
  const [fetchNote, setFetchNote] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  // «Leser verbinden» braucht einen zweiten Tipp (steht neben dem Eingabefeld)
  const [confirmStart, setConfirmStart] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const esRef = useRef<AbortController | null>(null)

  const banks = data ?? []
  const openBank = useMemo(() => [...banks].reverse().find((b) => !b.bank.closed_at) ?? null, [banks])
  const latestBank = banks.length > 0 ? banks[banks.length - 1] : null
  const currentBank = openBank ?? latestBank
  const shownBank = (pickedBankId && banks.find((b) => b.bank.id === pickedBankId)) || currentBank

  // anderer Tag: wieder der neuesten Bank folgen
  useEffect(() => setPickedBankId(null), [date])
  // Abgeschlossene Bänke sind gesperrt (nur ansehen); «Korrigieren» schaltet eine frei, bis zum Wechsel der Bank
  const [unlockedBankId, setUnlockedBankId] = useState<string | null>(null)
  useEffect(() => setUnlockedBankId(null), [date, shownBank?.bank.id])
  const locked = !!shownBank?.bank.closed_at && unlockedBankId !== shownBank.bank.id
  // ganzer Tag abgeschlossen: es gibt Bänke, aber keine offene mehr
  const dayClosed = banks.length > 0 && !openBank
  const [confirmClose, setConfirmClose] = useState(false)
  const daySlots = banks.flatMap((b) => b.slots.map((sl) => ({ bank: b.bank.bank_number, slot: sl })))
  const dayWeighed = daySlots.filter((x) => x.slot.milk_kg != null && Number(x.slot.milk_kg) > 0)
  const dayMissing = daySlots.filter((x) => !(x.slot.milk_kg != null && Number(x.slot.milk_kg) > 0))
  const dayTotal = Math.round(dayWeighed.reduce((t, x) => t + Number(x.slot.milk_kg), 0) * 10) / 10
  const dayAnimalIds = useMemo(() => [...new Set(daySlots.flatMap((x) => (x.slot.animal_id ? [x.slot.animal_id] : [])))].sort(), [daySlots])
  const dayLabels = useMemo(() => Object.fromEntries(daySlots.flatMap((x) => (x.slot.animal_id ? [[x.slot.animal_id, x.slot.animal?.lauf_nr ?? shortEarTag(x.slot.ear_tag ?? x.slot.animal?.ear_tag ?? '')]] : []))), [daySlots])

  useEffect(() => {
    api<{ enabled: boolean }>(`/${moduleKey}/reader/status`)
      .then((r) => setReaderEnabled(r.enabled))
      .catch(() => setReaderEnabled(false))
    api<SessionState>(`/${moduleKey}/reader/session`).then(setSession).catch(() => null)
  }, [moduleKey])

  // SSE: jede Änderung der Server-Sitzung → sofortiger Sync-Pull.
  useEffect(() => {
    const controller = new AbortController()
    esRef.current = controller
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/${moduleKey}/reader/session/events`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) return
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
            const state = JSON.parse(line.slice(6)) as SessionState & { events?: ReaderEvent[] }
            setSession(state)
            const events = state.events ?? []
            if (events.length > 0) {
              // Lesungen sofort lokal eintragen (Bänke vor Slots — FK), dann Anzeige auffrischen
              for (const ev of events.filter((e) => e.kind === 'milking_banks')) await applyReaderEvent(pg, ev)
              for (const ev of events.filter((e) => e.kind === 'milking_slots')) await applyReaderEvent(pg, ev)
              notifyDataChanged()
            }
          }
        }
      } catch {
        // abgebrochen (Seite verlassen) oder offline — Sync-Loop läuft weiter
      }
    })()
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      setSession(await api<SessionState>(`/${moduleKey}/reader/session/start`, 'POST', { session_date: date, capacity }))
      await syncClient.syncNow()
    })
  const stop = () =>
    run(async () => {
      setSession(await api<SessionState>(`/${moduleKey}/reader/session/stop`, 'POST'))
      await syncClient.syncNow()
    })
  /** Neue, leere Bank öffnen (die bisherige wird abgeschlossen); mit Leser macht das der Server. */
  const nextBank = () =>
    run(async () => {
      if (session?.active) {
        setSession(await api<SessionState>(`/${moduleKey}/reader/session/next-bank`, 'POST'))
        await syncClient.syncNow()
      } else {
        await inTransaction(pg, async (tx) => {
          if (openBank) await upsertRow(tx, 'milking_banks', { ...openBank.bank, closed_at: new Date().toISOString() })
          await upsertRow(tx, 'milking_banks', {
            id: crypto.randomUUID(),
            session_date: date,
            bank_number: Math.max(0, ...banks.map((b) => b.bank.bank_number)) + 1,
            capacity,
            opened_at: new Date().toISOString(),
            closed_at: null,
            notes: null,
          } as MilkingBank)
        })
        refresh()
        // gleich senden: der Abruf vom Gerät (Server) soll diese Bank füllen, nicht eine eigene öffnen
        await syncClient.syncNow()
      }
      setPickedBankId(null)
    })

  /** Wägung des Tages abschliessen: offene Bank schliessen, Leser trennen. Danach ist alles gesperrt. */
  const closeDay = () =>
    run(async () => {
      if (session?.active) setSession(await api<SessionState>(`/${moduleKey}/reader/session/stop`, 'POST'))
      if (openBank) await upsertRow(pg, 'milking_banks', { ...openBank.bank, closed_at: new Date().toISOString() })
      setConfirmClose(false)
      setPickedBankId(null)
      refresh()
      await syncClient.syncNow()
    })
  /** Abgeschlossene Wägung wieder öffnen: die letzte Bank wird wieder offen. */
  const reopenDay = () =>
    run(async () => {
      if (latestBank) await upsertRow(pg, 'milking_banks', { ...latestBank.bank, closed_at: null })
      setPickedBankId(null)
      refresh()
      await syncClient.syncNow()
    })

  const fetchRecent = () =>
    run(async () => {
      setFetchNote(null)
      const r = await api<{ added: number; already_there: number; group: string | null; found: number }>(`/${moduleKey}/reader/session/fetch-recent`, 'POST', { session_date: date, capacity })
      await syncClient.syncNow()
      refresh()
      setFetchNote(
        r.found === 0
          ? 'Im Gerät ist keine Gruppe mit Lesungen.'
          : `${r.added} neu aufgenommen, ${r.already_there} schon vorhanden (aus Gruppe «${r.group ?? '?'}», letzte ${r.found} Lesungen).`,
      )
      if (r.added > 0) setPickedBankId(null)
    })

  // Fortlaufend neue Lesungen vom Gerät holen, solange die offene Bank freie Plätze hat (ohne Live-Verbindung, nur heute,
  // nur bei sichtbarer Seite). Leise: kein Sperren der Seite, Meldung nur bei neuen Tieren oder einem Fehler.
  const todayLocal = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const autoFetch = !!readerEnabled && canWrite && !session?.active && date === todayLocal && !!openBank && openBank.slots.length < openBank.bank.capacity
  const fetching = useRef(false)
  const [autoNote, setAutoNote] = useState<string | null>(null)
  useEffect(() => {
    if (!autoFetch) return
    const tick = async () => {
      if (fetching.current || document.visibilityState !== 'visible') return
      fetching.current = true
      try {
        const r = await api<{ added: number; already_there: number; group: string | null; found: number; waiting: number }>(`/${moduleKey}/reader/session/fetch-recent`, 'POST', { session_date: date, capacity })
        if (r.added > 0) {
          await syncClient.syncNow()
          refresh()
        }
        setAutoNote(r.added > 0 ? `${r.added} neu vom Gerät geholt` : r.waiting > 0 ? `${r.waiting} weitere warten auf die nächste Bank (unten «+»)` : null)
      } catch (err) {
        setAutoNote(`Gerät nicht erreichbar: ${errorText(err)}`)
      } finally {
        fetching.current = false
      }
    }
    void tick()
    const t = setInterval(() => void tick(), AUTO_FETCH_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, openBank?.bank.id, date])

  // Vorschläge: Laufnummer beginnt mit / Ohrmarke enthält / Name beginnt mit
  const suggestions = useMemo(() => {
    const q = manualInput.trim().toLowerCase()
    if (!q) return []
    const inBank = new Set((openBank?.slots ?? []).map((s) => s.animal_id))
    const all = animalsData ?? []
    const score = (a: Animal): number => {
      const ln = (a.lauf_nr ?? '').toLowerCase()
      const et = a.ear_tag.toLowerCase()
      const nm = (a.name ?? '').toLowerCase()
      if (ln === q || et === q) return 0
      if (ln.startsWith(q)) return 1
      if (et.endsWith(q) || et.includes(q)) return 2
      if (nm.startsWith(q)) return 3
      if (nm.includes(q)) return 4
      return -1
    }
    return all
      .map((a) => ({ a, s: score(a), inBank: inBank.has(a.id) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => x.s - y.s || (x.a.lauf_nr ?? '').localeCompare(y.a.lauf_nr ?? ''))
      .slice(0, 8)
  }, [manualInput, animalsData, openBank])

  /** Manuelle Aufnahme (ohne Leser): Laufnummer oder Ohrmarke — offline möglich.
   * Ohne Treffer nur auf ausdrücklichen Wunsch (`unknown`) als unbekannte
   * Ohrmarke — sonst würde aus jedem Tippfehler («1O1») ein Phantomtier. */
  async function addManual(chosen?: Animal, unknown = false) {
    const q = manualInput.trim()
    if (!chosen && !q) return
    await run(async () => {
      let animal: Animal | null = chosen ?? null
      if (!animal) {
        // Enter ohne Auswahl: eindeutiger Treffer (oder exakte Laufnummer/Ohrmarke)
        const exact = suggestions.find((x) => x.s === 0)
        animal = exact?.a ?? (suggestions.length === 1 ? suggestions[0].a : null)
      }
      if (animal) {
        const pos = openBank?.slots.find((x) => x.animal_id === animal!.id)?.position
        if (pos != null) throw new Error(`${animal.lauf_nr ?? shortEarTag(animal.ear_tag)} ist schon auf Platz ${pos}.`)
      } else if (!unknown) {
        throw new Error(suggestions.length > 1 ? `«${q}» passt auf mehrere Tiere — bitte aus der Liste wählen.` : `Kein Tier «${q}» gefunden. Tippfehler?`)
      } else {
        const problem = earTagProblem(q)
        if (problem) throw new Error(problem)
      }
      let bank = openBank?.bank ?? null
      let count = openBank?.slots.length ?? 0
      // Gewünschter Platz (1 bis Plätze der Bank): dort einfügen, die folgenden rücken nach
      const wanted = manualPlace.trim() === '' ? null : Number(manualPlace)
      if (wanted != null) {
        if (!Number.isInteger(wanted) || wanted < 1 || wanted > (bank?.capacity ?? capacity) + MANUAL_EXTRA) throw new Error(`Platz muss zwischen 1 und ${(bank?.capacity ?? capacity) + MANUAL_EXTRA} liegen.`)
        if (bank && count >= bank.capacity + MANUAL_EXTRA) throw new Error('Die Bank ist voll. Zuerst unten «+» (neue Bank), dann den Platz wählen.')
        if (wanted > count + 1) throw new Error(`Der nächste freie Platz ist ${count + 1}: Plätze dürfen keine Lücke haben.`)
      }
      // neue Bank und Platz zusammen: ganz oder gar nicht
      await inTransaction(pg, async (tx) => {
      // manuell ausnahmsweise bis zu MANUAL_EXTRA Tiere über die Plätze hinaus, danach neue Bank
      if (!bank || count >= bank.capacity + MANUAL_EXTRA) {
        if (bank) await upsertRow(tx, 'milking_banks', { ...bank, closed_at: new Date().toISOString() })
        bank = {
          id: crypto.randomUUID(),
          session_date: date,
          bank_number: banks.length + 1,
          capacity,
          opened_at: new Date().toISOString(),
          closed_at: null,
          notes: null,
        } as MilkingBank
        await upsertRow(tx, 'milking_banks', bank)
        count = 0
      }
      // neue Bank: Platz gilt dort; sonst folgende Tiere um eins nach hinten
      const place = wanted != null && wanted <= count + 1 ? wanted : count + 1
      if (place <= count && openBank && bank && bank.id === openBank.bank.id) {
        for (const other of [...openBank.slots].filter((x) => x.position >= place).sort((a, b) => b.position - a.position)) {
          const { animal: _a, ...row } = other
          await upsertRow(tx, 'milking_slots', { ...row, position: other.position + 1 })
        }
      }
      await upsertRow(tx, 'milking_slots', {
        id: crypto.randomUUID(),
        bank_id: bank!.id,
        position: place,
        original_position: count + 1,
        transponder: null,
        ear_tag: animal?.ear_tag ?? q,
        animal_id: animal?.id ?? null,
        weighed: false,
        notes: null,
        read_at: new Date().toISOString(),
      })
      })
      setManualInput('')
      setManualPlace('')
      requestAnimationFrame(() => manualRef.current?.focus())
      setSuggestOpen(false)
      setSuggestIdx(0)
      refresh()
    })
  }

  const onChanged = useCallback(() => refresh(), [refresh])

  // Kopfzeile beim Hinunterscrollen ausblenden (core/Layout.tsx), damit die ganze Bank Platz hat
  useEffect(() => {
    document.body.dataset.autohideHeader = 'on'
    return () => {
      delete document.body.dataset.autohideHeader
    }
  }, [])
  // Beim Öffnen gleich zur Bank: Datum, Leser und Anleitung stehen darüber (hinaufscrollen)
  useEffect(() => {
    if (scrolledToBank.current || !data || readerEnabled === null) return
    scrolledToBank.current = true
    requestAnimationFrame(() => bankRef.current?.scrollIntoView({ block: 'start' }))
  }, [data, readerEnabled])

  if (readerEnabled === null) return <div className="p-4 text-center text-gray-500">Lädt…</div>

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 pb-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-gray-800">Milchwägung</h1>
        <button type="button" onClick={() => setShowGuide(true)} aria-label="Anleitung" title="Anleitung Schritt für Schritt" className="grid h-11 w-11 place-items-center rounded-full border-2 border-gray-300 bg-white text-lg font-bold text-brand-700">
          ⓘ
        </button>
        <span className="flex-1" />
        {editDate ? (
          <input
            type="date"
            value={date}
            autoFocus
            onChange={(e) => e.target.value && setDate(e.target.value)}
            onBlur={() => setEditDate(false)}
            className="min-h-11 rounded border border-gray-300 px-2 text-base"
          />
        ) : (
          <span className="flex items-center gap-1 text-base font-semibold text-gray-800">
            📅 {new Date(`${date}T12:00:00`).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })}
            <button type="button" onClick={() => setEditDate(true)} aria-label="Datum der Erfassung ändern" title="Datum ändern" className="grid h-11 w-11 place-items-center rounded-lg text-lg">
              ✏️
            </button>
          </span>
        )}
      </div>
      {showGuide && <MilkingGuide plural={terms.plural} onClose={() => setShowGuide(false)} />}

      {/* Leser-Sitzung */}
      <div className="rounded-lg bg-white p-3 shadow-sm">
        {readerEnabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                session?.active ? (session.last_error ? 'bg-red-500' : session.handshake ? 'bg-green-500' : 'bg-amber-400') : 'bg-gray-300'
              }`}
            />
            <span className="text-sm text-gray-700">
              {session?.active
                ? `${session.handshake ? 'Leser antwortet' : 'Verbinde…'} · ${session.reads} gelesen · Bank ${session.bank_number || '–'}${
                    session.last_read_at ? ` · letzte Lesung ${fmtDateTime(session.last_read_at)}` : ''
                  }`
                : 'Leser nicht verbunden'}
            </span>
            <span className="flex-1" />
            {canWrite &&
              (session?.active ? (
                <button type="button" onClick={stop} disabled={busy} className="link-btn rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700">
                  Leser trennen
                </button>
              ) : (
                confirmStart ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmStart(false)
                        void start()
                      }}
                      disabled={busy}
                      className="min-h-11 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white"
                    >
                      Ja, Leser verbinden
                    </button>
                    <button type="button" onClick={() => setConfirmStart(false)} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm">
                      Abbrechen
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmStart(true)} disabled={busy} className="min-h-11 rounded-lg bg-brand-700 px-3 text-sm font-medium text-white">
                    📡 Leser verbinden …
                  </button>
                )
              ))}
            {canWrite && (
              <button type="button" onClick={fetchRecent} disabled={busy} title="Holt die letzten Lesungen (höchstens 12) der letzten Gruppe aus dem Gerät, die hier noch fehlen. Eine laufende Verbindung wird dafür kurz unterbrochen." className="min-h-11 rounded-lg border-2 border-brand-700 px-3 text-sm font-semibold text-brand-700 disabled:opacity-50">
                ⬇ Letzte Lesungen holen
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Ohrmarkenleser für diese Instanz nicht aktiviert (Verwaltung → Module) — manuelle Aufnahme unten.</p>
        )}
        {fetchNote && <p className="mt-2 text-sm text-gray-700">{fetchNote}</p>}
        {session?.last_error && (
          <div className="mt-2 text-sm text-red-700">
            {/nicht erreichbar|unreachable|route to host|refused|timed out/i.test(session.last_error)
              ? 'Leser nicht erreichbar – eingeschaltet und im selben WLAN?'
              : 'Verbindung zum Leser fehlgeschlagen.'}
            <details className="text-xs text-gray-600">
              <summary className="min-h-11 cursor-pointer">Technische Angaben</summary>
              {session.last_error}
            </details>
          </div>
        )}
        {session?.active && session.last_ignored && (
          <p className="mt-2 text-xs text-amber-700">Letzte Lesung übersprungen: {session.last_ignored}</p>
        )}
        {readerEnabled && (
          <div className="mt-2 text-xs">
            <button type="button" onClick={() => setShowDetails((v) => !v)} className="text-brand-700">
              {showDetails ? '▾' : '▸'} Details zur Leserverbindung
              {session?.active && (
                <span className={`ml-2 ${quality(session, now).color}`}>Qualität: {quality(session, now).label}</span>
              )}
            </button>
            {showDetails && session && (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded bg-gray-50 p-2 text-gray-600">
                <dt>Gerät</dt>
                <dd>{session.host ? `${session.host}:${session.port}` : '–'}</dd>
                <dt>Verbunden seit</dt>
                <dd>{session.connected_since ? fmtDateTime(session.connected_since) : '–'}</dd>
                <dt>Handshake</dt>
                <dd>
                  {session.handshake
                    ? `OK · ${session.handshake.split('|')[0]} Datensätze im Gerätespeicher (${session.handshake})`
                    : session.active
                      ? 'ausstehend'
                      : '–'}
                </dd>
                <dt>Keep-alive</dt>
                <dd>
                  {session.pings} gesendet · {session.pongs} beantwortet
                  {session.last_pong_at ? ` · letzte Antwort vor ${Math.max(0, Math.round((now - new Date(session.last_pong_at).getTime()) / 1000))} s` : ''}
                  {session.rtt_ms != null ? ` · Umlaufzeit ${Math.round(session.rtt_ms)} ms` : ''}
                </dd>
                <dt>Qualität</dt>
                <dd className={quality(session, now).color}>{quality(session, now).label}</dd>
                <dt>Lesungen</dt>
                <dd>
                  {session.reads} Tiere · {session.frames} Frames
                  {session.last_read_at ? ` · letzte ${fmtDateTime(session.last_read_at)}` : ''}
                </dd>
                <dt>Rauschen</dt>
                <dd>{session.noise_bytes} Bytes verworfen</dd>
                <dt>Gestartet von</dt>
                <dd>{session.started_by ?? '–'}</dd>
              </dl>
            )}
            {showDetails && (
              <p className="mt-1 text-gray-500">
                Die Sitzung läuft auf dem Server — die Seite darf verlassen werden, der Leser liest weiter. Ist eine
                Bank voll, beginnt automatisch die nächste. Eine Funksignalstärke (WLAN) liefert der Leser nicht; die
                Qualität wird aus den Keep-alive-Antworten (alle 20 s) abgeleitet.
              </p>
            )}
          </div>
        )}
        {session?.active && session.session_date && session.session_date !== date && (
          <p className="mt-2 text-xs text-amber-700">Die laufende Sitzung gehört zum {fmtDate(session.session_date)}.</p>
        )}
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {/* Gewählte Bank (Vorgabe: die offene bzw. letzte); Seitenwähler und «+» (neue Bank) darunter */}
      <section ref={bankRef} className="scroll-mt-1 space-y-1">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold text-gray-800">{shownBank ? `Bank ${shownBank.bank.bank_number}` : 'Keine Bank'}</h2>
        {shownBank && !shownBank.bank.closed_at && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-800">offen</span>}
        {shownBank?.bank.closed_at && (locked ? <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-700">🔒 abgeschlossen</span> : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">✏️ Korrektur</span>)}
        {shownBank && (
          <span className="text-sm text-gray-600">
            {shownBank.slots.filter((s) => s.milk_kg != null && Number(s.milk_kg) > 0).length}/{shownBank.slots.length} gewogen · {shownBank.bank.capacity} Plätze
          </span>
        )}
        {shownBank?.bank.closed_at && canWrite && (
          <button
            type="button"
            onClick={() => setUnlockedBankId(locked ? shownBank.bank.id : null)}
            className={`ml-auto min-h-9 rounded-lg border px-2.5 text-sm font-medium ${locked ? 'border-gray-300 bg-white text-gray-700' : 'border-amber-500 bg-amber-50 text-amber-900'}`}
            title={locked ? 'Abgeschlossene Bank zum Korrigieren freigeben' : 'Wieder sperren'}
          >
            {locked ? '✏️ Korrigieren' : '🔒 Sperren'}
          </button>
        )}
      </div>
      {shownBank && shownBank.slots.length === 0 && !shownBank.bank.closed_at && canWrite && readerEnabled && (
        <button type="button" onClick={fetchRecent} disabled={busy} className="flex min-h-24 w-full items-center justify-center gap-3 rounded-2xl border-4 border-dashed border-brand-700 bg-brand-50 px-4 text-xl font-bold text-brand-800 active:bg-brand-100 disabled:opacity-50">
          <span aria-hidden className="text-4xl">📡</span>
          {busy ? 'hole Ohrmarken …' : 'Neu gelesene Ohrmarken holen'}
        </button>
      )}
      {fetchNote && shownBank?.slots.length === 0 && <p className="text-sm text-gray-700">{fetchNote}</p>}
      {autoFetch && shownBank?.bank.id === openBank?.bank.id && (
        <p className="text-xs text-gray-600" aria-live="polite">
          📡 holt neue Lesungen vom Gerät alle {AUTO_FETCH_MS / 1000} s, bis die {openBank?.bank.capacity} Plätze voll sind{autoNote ? ` · ${autoNote}` : ''}
        </p>
      )}
      {!autoFetch && autoNote && <p className="text-xs text-gray-600">{autoNote}</p>}
      {shownBank ? (
        <BankTable key={shownBank.bank.id} bank={shownBank} terms={terms} canWrite={canWrite && !locked} onChanged={onChanged} milking={milking} />
      ) : (
        <p className="text-center text-sm text-gray-500">
          {session?.active ? 'Warte auf die erste Lesung…' : 'Leser verbinden, Ohrmarken holen oder unten manuell aufnehmen.'}
        </p>
      )}
      </section>

      {canWrite && !dayClosed && (
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault()
            const pick = suggestOpen ? suggestions[suggestIdx]?.a : undefined
            void addManual(pick)
          }}
        >
          <div className="flex gap-2">
            <input
              ref={manualRef}
              type="text"
              placeholder="Manuell: Laufnummer, Ohrmarke oder Name"
              aria-label="Tier von Hand aufnehmen: Laufnummer, Ohrmarke oder Name"
              value={manualInput}
              inputMode={abc ? 'text' : 'numeric'}
              autoComplete="off"
              onChange={(e) => {
                setManualInput(e.target.value)
                setError(null)
                setSuggestOpen(true)
                setSuggestIdx(0)
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
              onKeyDown={(e) => {
                if (!suggestOpen || suggestions.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSuggestIdx((i) => Math.min(i + 1, suggestions.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSuggestIdx((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Escape') {
                  setSuggestOpen(false)
                }
              }}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="Platz"
              value={manualPlace}
              onChange={(e) => setManualPlace(e.target.value.replace(/\D/g, '').slice(0, 2))}
              aria-label="Platz in der Bank (1 bis 12, leer = nächster freier)"
              title="Platz in der Bank, z.B. für ein Tier, dessen Ohrmarke nicht gelesen wurde. Leer = nächster freier Platz."
              className="min-h-11 w-16 shrink-0 rounded-lg border border-gray-300 px-2 text-center text-base"
            />
            <button
              type="button"
              onClick={() => setAbc((v) => !v)}
              aria-pressed={abc}
              aria-label={abc ? 'Zahlentastatur' : 'Buchstaben-Tastatur (Name)'}
              className="min-h-11 shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 text-sm font-medium text-gray-800"
            >
              {abc ? '123' : 'ABC'}
            </button>
            <button
              type="submit"
              // Fokus bleibt im Feld (auch wenn die Aufnahme scheitert)
              onMouseDown={(e) => e.preventDefault()}
              disabled={busy || !manualInput.trim()}
              className="link-btn rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-700 disabled:opacity-50"
            >
              Aufnehmen
            </button>
          </div>
          {suggestOpen && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {suggestions.map(({ a, inBank }, i) => (
                <li
                  key={a.id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void addManual(a)
                  }}
                  onMouseEnter={() => setSuggestIdx(i)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === suggestIdx ? 'bg-brand-50' : ''}`}
                >
                  <AnimalOption animal={a} extra={inBank && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">schon in Bank</span>} />
                </li>
              ))}
            </ul>
          )}
          {manualInput.trim() && suggestions.length === 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
              <span>Kein Tier gefunden.</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void addManual(undefined, true)}
                className="min-h-11 rounded-lg border border-gray-400 px-3 font-medium text-gray-800 disabled:opacity-50"
              >
                Als unbekannte Ohrmarke aufnehmen
              </button>
            </div>
          )}
        </form>
      )}

      {(banks.length > 0 || canWrite) && (
        <BankPager
          banks={banks.map((b) => ({ id: b.bank.id, number: b.bank.bank_number }))}
          selectedId={shownBank?.bank.id ?? null}
          onSelect={(id) => setPickedBankId(id === currentBank?.bank.id ? null : id)}
          onNew={canWrite && !dayClosed ? () => void nextBank() : undefined}
          busy={busy}
        />
      )}

      {/* Abschluss der Wägung: Übersicht, fehlende kg, danach alles gesperrt */}
      {dayClosed ? (
        <section className="space-y-2 rounded-xl border-2 border-green-600 bg-green-50 p-3">
          <p className="font-semibold text-green-900">✓ Milchwägung vom {fmtDate(date)} abgeschlossen</p>
          <p className="text-sm text-green-900">
            {dayWeighed.length} von {daySlots.length} Tieren gewogen, zusammen {dayTotal.toLocaleString('de-CH')} kg
            {dayWeighed.length > 0 ? ` (Ø ${(dayTotal / dayWeighed.length).toFixed(2)} kg)` : ''}. Alle Bänke sind gesperrt; einzelne lassen sich mit «✏️ Korrigieren» freigeben.
          </p>
          <GroupCheck moduleKey={moduleKey} date={date} animalIds={dayAnimalIds} labels={dayLabels} />
          {canWrite && (
            <button type="button" disabled={busy} onClick={() => void reopenDay()} className="min-h-11 rounded-lg border border-gray-400 bg-white px-3 text-sm font-medium text-gray-800 disabled:opacity-50">
              Wägung wieder öffnen
            </button>
          )}
        </section>
      ) : (
        canWrite &&
        openBank && (
          <section className="space-y-2">
            {!confirmClose ? (
              <button type="button" disabled={busy} onClick={() => setConfirmClose(true)} className="min-h-14 w-full rounded-xl border-2 border-green-700 bg-white text-lg font-bold text-green-800 active:bg-green-50 disabled:opacity-50">
                ✓ Wägung abschliessen
              </button>
            ) : (
              <div className="space-y-2 rounded-xl border-2 border-green-700 bg-white p-3">
                <p className="font-semibold text-gray-900">Wägung vom {fmtDate(date)} abschliessen?</p>
                <p className="text-sm text-gray-700">
                  {dayWeighed.length} von {daySlots.length} Tieren gewogen, zusammen {dayTotal.toLocaleString('de-CH')} kg.
                  {session?.active ? ' Der Leser wird getrennt.' : ''} Danach sind alle Bänke gesperrt.
                </p>
                <GroupCheck moduleKey={moduleKey} date={date} animalIds={dayAnimalIds} labels={dayLabels} />
                {dayMissing.length > 0 && (
                  <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
                    Ohne kg: {dayMissing.map((x) => `Bank ${x.bank} Platz ${x.slot.position} (${x.slot.animal?.lauf_nr ?? x.slot.ear_tag ?? '?'})`).join(', ')}
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void closeDay()} className="min-h-12 flex-1 rounded-lg bg-green-700 font-semibold text-white disabled:opacity-50">
                    {dayMissing.length > 0 ? 'Trotzdem abschliessen' : 'Abschliessen'}
                  </button>
                  <button type="button" onClick={() => setConfirmClose(false)} className="min-h-12 rounded-lg border border-gray-300 px-4 text-gray-700">
                    Zurück
                  </button>
                </div>
              </div>
            )}
          </section>
        )
      )}
    </div>
  )
}

/** Seitenwähler für die Bänke des Tages («« 1 2 3 »» +): die gewählte Seite ist grau, die übrigen sind antippbar; «+» öffnet eine
 * neue, leere Bank (die offene wird abgeschlossen). */
function BankPager({ banks, selectedId, onSelect, onNew, busy }: { banks: { id: string; number: number }[]; selectedId: string | null; onSelect: (id: string) => void; onNew?: () => void; busy?: boolean }) {
  const idx = Math.max(0, banks.findIndex((b) => b.id === selectedId))
  const show = (i: number) => banks.length <= 7 || i === 0 || i === banks.length - 1 || Math.abs(i - idx) <= 1
  const items: (number | 'gap')[] = []
  banks.forEach((_, i) => {
    if (show(i)) items.push(i)
    else if (items[items.length - 1] !== 'gap') items.push('gap')
  })
  const cell = 'grid min-h-14 min-w-14 place-items-center border-r border-gray-300 px-3 text-xl last:border-r-0'
  return (
    <nav aria-label="Bänke des Tages" className="flex justify-center pb-4 pt-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white">
        {banks.length > 0 && (
          <button type="button" onClick={() => onSelect(banks[idx - 1].id)} disabled={idx <= 0} aria-label="vorherige Bank" className={`${cell} ${idx <= 0 ? 'text-gray-400' : 'text-brand-700 active:bg-gray-50'}`}>
            «
          </button>
        )}
        {items.map((it, k) =>
          it === 'gap' ? (
            <span key={`g${k}`} className={`${cell} text-gray-500`}>
              …
            </span>
          ) : (
            <button
              key={banks[it].id}
              type="button"
              onClick={() => onSelect(banks[it].id)}
              disabled={it === idx}
              aria-current={it === idx ? 'page' : undefined}
              aria-label={`Bank ${banks[it].number}`}
              className={`${cell} ${it === idx ? 'bg-gray-100 font-semibold text-gray-500' : 'text-brand-700 active:bg-gray-50'}`}
            >
              {banks[it].number}
            </button>
          ),
        )}
        {banks.length > 0 && (
          <button type="button" onClick={() => onSelect(banks[idx + 1].id)} disabled={idx >= banks.length - 1} aria-label="nächste Bank" className={`${cell} ${idx >= banks.length - 1 ? 'text-gray-400' : 'text-brand-700 active:bg-gray-50'}`}>
            »
          </button>
        )}
        {onNew && (
          <button type="button" onClick={onNew} disabled={busy} aria-label="Neue Bank öffnen" title="Neue, leere Bank öffnen (die offene wird abgeschlossen)" className={`${cell} bg-brand-700 font-bold text-white active:bg-brand-800 disabled:opacity-50`}>
            +
          </button>
        )}
      </div>
    </nav>
  )
}

/** Einstellungen im Zahnrad-Menü (core/pageSettings.ts): Schrittweite, Sprung beim Gedrückthalten, Plätze je Bank. */
function MilkingSettingsPanel({ moduleKey, species }: { moduleKey: string; species: 'sheep' | 'cattle' }) {
  const s = useMilkingSettings(moduleKey, species)
  const field = (k: keyof MilkingSettings, label: string, step: number) => (
    <label key={k} className="flex min-h-11 items-center justify-between gap-2 text-sm text-gray-800">
      {label}
      <NumberInput
        step={step}
        min={step}
        value={s[k]}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v > 0) saveMilkingSettings(moduleKey, { ...readMilkingSettings(moduleKey, species), [k]: k === 'capacity' ? Math.round(v) : v })
        }}
        className="h-11 w-20 rounded border border-gray-300 px-2 text-right text-base"
      />
    </label>
  )
  return (
    <div className="space-y-1">
      {field('step', 'Schritt + / − (kg)', 0.05)}
      {field('holdStep', 'Gedrückt halten: Sprung (kg)', 0.1)}
      {field('capacity', 'Plätze je Bank', 1)}
    </div>
  )
}

/** Anleitung Schritt für Schritt (Knopf ⓘ). */
function MilkingGuide({ plural, onClose }: { plural: string; onClose: () => void }) {
  const steps: [string, string, string][] = [
    ['📡', 'Leser verbinden', 'Oben in der Kachel «Leser verbinden». Jede gelesene Ohrmarke kommt der Reihe nach in die offene Bank.'],
    ['⬇', 'Oder: Ohrmarken holen', `Wurde ohne Verbindung gelesen, holt «Neu gelesene Ohrmarken holen» die letzten (höchstens 12) ${plural} aus dem Gerät.`],
    ['⚖️', 'Milch eintragen', 'Mit + und − (antippen: kleiner Schritt, gedrückt halten: grosser Sprung) oder die Zahl antippen und tippen. Grün = gewogen, gespeichert wird von selbst.'],
    ['✍️', 'Fehlt ein Tier?', 'Unter der Bank Laufnummer und Platz (1–12) eintragen, «Aufnehmen». Die folgenden rutschen nach.'],
    ['➕', 'Nächste Bank', 'Ganz unten «+»: schliesst die Bank und öffnet eine neue, leere. Mit den Zahlen davor springst du zu früheren Bänken des Tages.'],
    ['✎', 'Korrigieren', '«Bearbeiten» über der Bank: Reihenfolge ändern, Notiz, Zeile löschen.'],
    ['⚙️', 'Einstellungen', 'Zahnrad oben rechts: Schrittweite, Sprung beim Gedrückthalten, Plätze je Bank.'],
    ['📅', 'Datum', 'Gilt für alle Bänke dieser Wägung. Ändern nur mit dem Stift (z.B. Nachtrag).'],
  ]
  return (
    <Modal title="Milchwägung: so geht es" onClose={onClose} dirty={false}>
      <ol className="space-y-3">
        {steps.map(([icon, title, text], i) => (
          <li key={title} className="flex gap-3">
            <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-50 text-xl">{icon}</span>
            <span className="text-sm text-gray-800">
              <b>
                {i + 1}. {title}
              </b>
              <span className="block text-gray-700">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-gray-600">Beim Hinunterscrollen verschwindet die Kopfzeile, beim Hinaufscrollen kommen Kopfzeile, Datum und Leser wieder.</p>
    </Modal>
  )
}

/** Milch in kg mit grossen Knöpfen − und + (für Handschuhe): antippen = `step`, gedrückt halten = wiederholt `holdStep`.
 * Die Zahl lässt sich auch antippen und tippen. Gespeichert wird kurz nach der letzten Änderung und beim Verlassen. */
function MilkStepper({ value, disabled, onSave, label, step, holdStep }: { value: number | string | null | undefined; disabled: boolean; onSave: (kg: number | null) => void; label: string; step: number; holdStep: number }) {
  const stored = value == null || value === '' ? null : Number(value)
  const [kg, setKg] = useState<number | null>(stored)
  const [text, setText] = useState<string | null>(null)
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hold = useRef<{ start: ReturnType<typeof setTimeout> | null; repeat: ReturnType<typeof setInterval> | null; held: boolean }>({ start: null, repeat: null, held: false })
  const latest = useRef(onSave)
  latest.current = onSave
  const kgRef = useRef(kg)
  kgRef.current = kg

  // Neuer Stand aus der Datenbank nur übernehmen, solange hier nichts ungespeichert ist
  useEffect(() => {
    if (!dirty.current && text == null) setKg(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored])

  const flush = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!dirty.current) return
    dirty.current = false
    latest.current(kgRef.current)
  }
  useEffect(() => () => flush(), [])

  function change(next: number | null) {
    const v = next == null ? null : Math.max(0, Math.min(99, roundKg(next)))
    setKg(v)
    kgRef.current = v
    dirty.current = true
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 700)
  }
  const bump = (d: number) => change((kgRef.current ?? 0) + d)

  function press(dir: 1 | -1) {
    if (disabled) return
    hold.current.held = false
    hold.current.start = setTimeout(() => {
      hold.current.held = true
      bump(dir * holdStep)
      hold.current.repeat = setInterval(() => bump(dir * holdStep), 220)
    }, 400)
  }
  function release(dir: 1 | -1, cancelled = false) {
    if (hold.current.start) clearTimeout(hold.current.start)
    if (hold.current.repeat) clearInterval(hold.current.repeat)
    hold.current.start = hold.current.repeat = null
    if (!hold.current.held && !cancelled) bump(dir * step)
    hold.current.held = false
  }
  const btn = 'grid h-11 w-12 shrink-0 select-none place-items-center rounded-xl border-2 text-2xl font-bold touch-none disabled:opacity-40'
  const done = kg != null && kg > 0
  return (
    <div className="flex items-center justify-end gap-1">
{!disabled && (
      <button type="button" disabled={disabled} aria-label={`${label}: weniger`} onPointerDown={() => press(-1)} onPointerUp={() => release(-1)} onPointerLeave={() => release(-1, true)} onPointerCancel={() => release(-1, true)} onContextMenu={(e) => e.preventDefault()} className={`${btn} border-gray-400 bg-white text-gray-800 active:bg-gray-100`}>
        −
      </button>
      )}
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        value={text ?? (kg == null ? '' : kg.toFixed(kg * 10 === Math.round(kg * 10) ? 1 : 2))}
        disabled={disabled}
        placeholder="kg"
        aria-label={`Milch kg ${label}`}
        onFocus={(e) => {
          setText(kg == null ? '' : String(kg))
          e.currentTarget.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const t = (text ?? '').trim().replace(',', '.')
          setText(null)
          if (t === '') {
            if (kg != null) change(null)
          } else if (Number.isFinite(Number(t)) && Number(t) >= 0) change(Number(t))
          flush()
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={`h-11 w-16 rounded-xl border-2 px-1 text-center text-xl font-bold tabular-nums ${done ? 'border-green-600 bg-green-50 text-green-900' : 'border-gray-300 bg-white text-gray-900'}`}
      />
{!disabled && (
      <button type="button" disabled={disabled} aria-label={`${label}: mehr`} onPointerDown={() => press(1)} onPointerUp={() => release(1)} onPointerLeave={() => release(1, true)} onPointerCancel={() => release(1, true)} onContextMenu={(e) => e.preventDefault()} className={`${btn} border-brand-700 bg-brand-700 text-white active:bg-brand-800`}>
        +
      </button>
      )}
    </div>
  )
}

function BankTable({
  bank,
  terms,
  canWrite,
  onChanged,
  milking,
}: {
  bank: BankWithSlots
  terms: ReturnType<typeof speciesTerms>
  canWrite: boolean
  onChanged: () => void
  milking: MilkingSettings
}) {
  const pg = useDb()
  const [editing, setEditing] = useState(false)
  const [order, setOrder] = useState<SlotRow[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const slots = bank.slots
  const byOriginal = useMemo(() => [...slots].sort((a, b) => a.original_position - b.original_position), [slots])

  function startEdit() {
    setOrder([...slots].sort((a, b) => a.position - b.position))
    setEditing(true)
  }
  function move(idx: number, dir: -1 | 1) {
    setOrder((o) => {
      const j = idx + dir
      if (j < 0 || j >= o.length) return o
      const copy = [...o]
      ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
      return copy
    })
  }

  // Ziehen an der Grifffläche. Von Hand statt mit einer Bibliothek: es sind
  // zwölf Zeilen, und die Zeiger-Ereignisse decken Maus und Finger gleich ab.
  // touch-none an der Fläche ist Pflicht, sonst scrollt das Handy statt zu
  // ziehen. Die Pfeiltasten bleiben daneben — mit nassen Händen im Melkstand
  // trifft man eine Schaltfläche zuverlässiger als eine Ziehgeste.
  function startDrag(e: React.PointerEvent<HTMLElement>, id: string) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragId(id)
  }

  function dragOver(e: React.PointerEvent<HTMLElement>) {
    if (dragId === null) return
    const from = order.findIndex((s) => s.id === dragId)
    if (from < 0) return

    const y = e.clientY
    let to = from
    for (let i = 0; i < order.length; i++) {
      const box = rowRefs.current[i]?.getBoundingClientRect()
      if (!box) continue
      // Über der ersten bzw. unter der letzten Zeile ans jeweilige Ende.
      if (i === 0 && y < box.top) break
      if (i === order.length - 1 && y > box.bottom) {
        to = i
        break
      }
      if (y >= box.top && y <= box.bottom) {
        to = i
        break
      }
    }
    if (to === from) return
    setOrder((o) => {
      const copy = [...o]
      const [moved] = copy.splice(from, 1)
      copy.splice(to, 0, moved)
      return copy
    })
  }

  function endDrag(e: React.PointerEvent<HTMLElement>) {
    if (dragId === null) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDragId(null)
  }
  async function saveOrder() {
    for (let i = 0; i < order.length; i++) {
      const s = order[i]
      if (s.position !== i + 1) {
        const { animal: _a, ...row } = s
        await upsertRow(pg, 'milking_slots', { ...row, position: i + 1 })
      }
    }
    setEditing(false)
    setDragId(null)
    onChanged()
  }

  async function saveMilk(s: SlotRow, kg: number | null) {
    const { animal: _a, ...row } = s
    await upsertRow(pg, 'milking_slots', { ...row, milk_kg: kg, weighed: kg != null && kg > 0 })
    onChanged()
  }

  async function toggleWeighed(s: SlotRow) {
    const { animal: _a, ...row } = s
    await upsertRow(pg, 'milking_slots', { ...row, weighed: !s.weighed })
    onChanged()
  }

  // ohne Rückfrage: «↶ Rückgängig» holt die Zeile samt Notiz zurück
  async function removeSlot(s: SlotRow) {
    await inTransaction(pg, async (tx) => {
      await softDeleteRow(tx, 'milking_slots', s.id)
      // die ins Tierjournal kopierte Notiz gehört zur Zeile
      const { rows } = await tx.query<{ id: string }>('select id from animal_journal where ref_id = $1 and deleted_at is null', [s.id])
      for (const r of rows) await softDeleteRow(tx, 'animal_journal', r.id)
      // Positionen der verbleibenden Zeilen lückenlos nachziehen
      const remaining = slots.filter((x) => x.id !== s.id).sort((a, b) => a.position - b.position)
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].position !== i + 1) {
          const { animal: _a, ...row } = remaining[i]
          await upsertRow(tx, 'milking_slots', { ...row, position: i + 1 })
        }
      }
    })
    if (editing) setOrder((o) => o.filter((x) => x.id !== s.id))
    onChanged()
  }

  function openNote(s: SlotRow) {
    setNoteFor(s.id)
    setNoteText(s.notes ?? '')
  }
  async function saveNote(s: SlotRow) {
    const text = noteText.trim()
    const { animal: _a, ...row } = s
    await inTransaction(pg, async (tx) => {
    await upsertRow(tx, 'milking_slots', { ...row, notes: text || null })
    // Ins Journal des Tiers kopieren (1:1 über ref_id = Slot; leer = löschen)
    if (s.animal_id) {
      const { rows } = await tx.query<{ id: string }>(
        'select id from animal_journal where ref_id = $1 and deleted_at is null',
        [s.id],
      )
      if (text) {
        await upsertRow(tx, 'animal_journal', {
          id: rows[0]?.id ?? crypto.randomUUID(),
          animal_id: s.animal_id,
          entry_date: bank.bank.session_date,
          source: 'milchwaegung',
          text: `Milchwägung Bank ${bank.bank.bank_number}: ${text}`,
          ref_id: s.id,
          category: 'notiz',
        })
      } else if (rows[0]) {
        await softDeleteRow(tx, 'animal_journal', rows[0].id)
      }
    }
    })
    setNoteFor(null)
    onChanged()
  }

  function label(s: SlotRow): string {
    return s.animal?.lauf_nr ?? s.animal?.name ?? s.ear_tag ?? s.transponder ?? '?'
  }

  const rows = editing ? order : [...slots].sort((a, b) => a.position - b.position)

  return (
    <div className="space-y-2">
      {editing && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button type="button" onClick={() => setEditing(false)} className="min-h-11 rounded px-3 text-sm text-gray-600">
            Abbrechen
          </button>
          <button type="button" onClick={saveOrder} className="min-h-11 rounded-lg bg-brand-700 px-3 text-sm font-medium text-white">
            Fertig
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              {/* Umsortieren: ohne Milchmenge und Notiz, damit die Tabelle aufs Handy passt */}
              {editing && <th className="w-8 px-1 py-1" />}
              {editing && <th className="px-1 py-1">Gelesen</th>}
              <th className="px-2 py-1">{editing ? 'Nr.' : 'Laufnr.'}</th>
              {editing ? <th className="px-2 py-1">{terms.singular}</th> : <th className="px-1 py-1 text-center">TVD</th>}
              {!editing && <th className="px-1 py-1 text-center">Tage</th>}
              {!editing && (
                <th className="px-1 py-0.5 text-right">
                  <span className="flex items-center justify-end gap-1">
                    {canWrite && slots.length > 0 && (
                      <button type="button" onClick={startEdit} title="Reihenfolge ändern, Notiz, Zeile löschen" className="min-h-11 rounded px-2 text-sm font-medium text-brand-700">
                        ✎ Bearbeiten
                      </button>
                    )}
                    Milch kg
                  </span>
                </th>
              )}
              {editing && <th className="px-1 py-2" />}
            </tr>
          </thead>
          <tbody>
            {!editing &&
              rows.map((s) => {
                const tvd = shortEarTag(s.ear_tag ?? s.animal?.ear_tag ?? '').replace(/\D/g, '').slice(-4)
                const dim = s.lastBirth ? Math.round((Date.parse(`${isoDate(bank.bank.session_date)}T00:00:00Z`) - Date.parse(`${s.lastBirth}T00:00:00Z`)) / 86_400_000) : null
                const done = s.milk_kg != null && Number(s.milk_kg) > 0
                return (
                  <Fragment key={s.id}>
                    <tr className={`border-b ${done ? 'bg-green-50/60' : ''}`}>
                      <td className="px-1.5 py-0.5 align-middle">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-bold leading-none text-gray-900">{s.animal?.lauf_nr ?? '–'}</span>
                          {s.withdrawalUntil && s.withdrawalUntil >= (isoDate(bank.bank.session_date) ?? '') && (
                            <span className="text-sm font-bold text-red-700" title={`Milch-Absetzfrist bis ${fmtDate(s.withdrawalUntil)}`} aria-label={`Absetzfrist bis ${fmtDate(s.withdrawalUntil)}`}>
                              ⚠
                            </span>
                          )}
                          {s.notes && <span className="text-xs text-brand-700" title={`Notiz: ${s.notes}`}>✎</span>}
                        </div>
                        <div className="max-w-[6rem] truncate text-[11px] leading-tight text-gray-500">
                          {s.position}. {s.animal?.name ?? (s.animal ? '' : <span className="text-amber-700">unbekannt</span>)}
                        </div>
                      </td>
                      <td className="px-1 py-0.5 text-center align-middle text-xl font-semibold tabular-nums text-gray-800">{tvd || '–'}</td>
                      <td className="px-1 py-0.5 text-center align-middle text-base tabular-nums text-gray-700">{dim != null && dim >= 0 ? dim : '–'}</td>
                      <td className="px-1 py-0.5 align-middle">
                        <MilkStepper value={s.milk_kg} disabled={!canWrite} onSave={(kg) => void saveMilk(s, kg)} label={s.animal?.lauf_nr ?? tvd} step={milking.step} holdStep={milking.holdStep} />
                      </td>
                    </tr>
                    {noteFor === s.id && (
                      <tr className="border-b bg-gray-50">
                        <td colSpan={5} className="px-2 py-2">
                          <form
                            className="flex gap-2"
                            onSubmit={(e) => {
                              e.preventDefault()
                              void saveNote(s)
                            }}
                          >
                            <input type="text" value={noteText} onChange={(e) => setNoteText(e.target.value)} autoFocus placeholder="Notiz" className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-gray-300 px-3 text-base" />
                            <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white">
                              OK
                            </button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            {editing && rows.map((s, idx) => (
              <tr
                key={s.id}
                ref={(el) => {
                  rowRefs.current[idx] = el
                }}
                onPointerMove={dragOver}
                className={`border-b last:border-0 ${s.weighed ? 'bg-green-50' : ''} ${
                  dragId === s.id ? 'bg-brand-50 shadow-inner' : ''
                }`}
              >
                {editing && (
                  <td className="px-1 py-0.5 align-middle">
                    <span
                      onPointerDown={(e) => startDrag(e, s.id)}
                      onPointerMove={dragOver}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      role="button"
                      aria-label={`${label(s)} verschieben`}
                      title="Zum Verschieben ziehen"
                      className="flex h-11 w-8 cursor-grab touch-none select-none items-center justify-center text-lg leading-none text-gray-500 active:cursor-grabbing active:text-brand-700"
                    >
                      ⣿
                    </span>
                  </td>
                )}
                {editing && (
                  <td className="px-1 py-0.5 align-middle text-xs text-gray-500">
                    {byOriginal[idx] ? `${byOriginal[idx].original_position}. ${label(byOriginal[idx])}` : ''}
                  </td>
                )}
                {!editing && (
                  <td className="px-0 py-0 align-middle">
                    <label className="grid h-11 w-11 place-items-center" title="gewogen">
                      <input
                        type="checkbox"
                        checked={s.weighed}
                        disabled={!canWrite}
                        onChange={() => toggleWeighed(s)}
                        className="h-6 w-6"
                        aria-label={`${label(s)} gewogen`}
                      />
                    </label>
                  </td>
                )}
                <td className="px-2 py-0.5 align-middle">
                  <span className="text-2xl font-bold leading-none text-gray-800">{s.animal?.lauf_nr ?? '–'}</span>
                  <span className="ml-1 text-xs text-gray-500">{editing ? idx + 1 : s.position}.</span>
                </td>
                <td className="px-2 py-0.5 align-middle">
                  <div className="truncate text-sm font-medium text-gray-800">
                    {s.animal?.name ?? (s.animal ? '' : <span className="text-amber-700">unbekannt</span>)}
                  </div>
                  {s.withdrawalUntil && s.withdrawalUntil >= (isoDate(bank.bank.session_date) ?? '') && (
                    <div className="text-xs font-semibold text-red-700">
                      ⚠ Milch-Absetzfrist bis {fmtDate(s.withdrawalUntil)}
                    </div>
                  )}
                  {/* Zweite Zeile kostet ~14 px mal zwölf. Auf kurzen Schirmen
                      weicht sie, damit Häkchen und Laufnummer ohne Scrollen
                      sichtbar bleiben — auf hohen Geräten ist sie da. */}
                  <div className="hidden text-xs text-gray-500 [@media(min-height:760px)]:block">
                    {shortEarTag(s.ear_tag)}
                    {s.transponder && s.transponder !== s.ear_tag ? ` · ${s.transponder}` : ''}
                  </div>
                </td>
                {!editing && (
                <td className="px-2 py-0.5 align-middle">
                  {noteFor === s.id ? (
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void saveNote(s)
                      }}
                    >
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        autoFocus
                        className="w-full min-w-[8rem] rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                      <button type="submit" className="link-btn rounded bg-brand-700 px-2 py-1 text-xs text-white">
                        OK
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => canWrite && openNote(s)}
                      className="flex min-h-11 items-center gap-1 text-left text-xs text-gray-600"
                      title="Notiz zur Wägung (wird ins Journal des Tiers kopiert)"
                    >
                      <span className="text-gray-500">✎</span>
                      <span className={s.notes ? '' : 'text-gray-300'}>{s.notes ?? 'Notiz'}</span>
                    </button>
                  )}
                </td>
                )}
                <td className="whitespace-nowrap px-1 py-0.5 align-middle text-xs">
                  {editing ? (
                    <div className="flex">
                      <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="grid h-11 w-10 place-items-center rounded text-base text-gray-600 disabled:opacity-30" aria-label="nach oben">
                        ▲
                      </button>
                      <button type="button" onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} className="grid h-11 w-10 place-items-center rounded text-base text-gray-600 disabled:opacity-30" aria-label="nach unten">
                        ▼
                      </button>
                      <button type="button" onClick={() => (noteFor === s.id ? setNoteFor(null) : openNote(s))} title={s.notes ? `Notiz: ${s.notes}` : 'Notiz zur Wägung (wird ins Journal des Tiers kopiert)'} aria-label="Notiz" className={`grid h-11 w-10 place-items-center rounded text-lg ${s.notes ? 'text-brand-700' : 'text-gray-400'}`}>
                        ✎
                      </button>
                      <button type="button" onClick={() => removeSlot(s)} className="grid h-11 w-10 place-items-center rounded text-xl leading-none text-red-700" title="Zeile löschen (falsch eingegeben)" aria-label="Zeile löschen">
                        ×
                      </button>
                    </div>
                  ) : (
                    canWrite && (
                    <button type="button" onClick={() => removeSlot(s)} className="grid h-11 w-11 place-items-center rounded text-lg leading-none text-red-700" title="Zeile löschen (falsch eingegeben)">
                      ×
                    </button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                  Noch keine Lesung.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && noteFor && (() => {
        const s = rows.find((x) => x.id === noteFor)
        if (!s) return null
        return (
          <form
            className="flex gap-2 rounded-lg bg-gray-50 p-2"
            onSubmit={(e) => {
              e.preventDefault()
              void saveNote(s)
            }}
          >
            <input type="text" value={noteText} onChange={(e) => setNoteText(e.target.value)} autoFocus placeholder={`Notiz zu ${label(s)}`} className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-gray-300 px-3 text-base" />
            <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white">
              OK
            </button>
          </form>
        )
      })()}
    </div>
  )
}

/** Abschluss der Wägung: in welchen Tiergruppen (Modul Tiere) die gewogenen Tiere stehen. Die Melkgruppe ist die
 * gemolkene Gruppe mit den meisten dieser Tiere (sonst die häufigste). Wer woanders oder in keiner Gruppe steht, wird
 * genannt; mit einem Knopf kommen diese Tiere ab dem Wägetag in die Melkgruppe. */
function GroupCheck({ moduleKey, date, animalIds, labels }: { moduleKey: string; date: string; animalIds: string[]; labels: Record<string, string> }) {
  const canMove = useHasPermission('tiere:herden:write') && !!animalProvider(moduleKey)
  const [herd, setHerd] = useState<HerdData | null>(null)
  const [busy, setBusy] = useState(false)
  const key = animalIds.join(',')
  const load = useCallback(() => loadHerdData().then(setHerd).catch(() => setHerd(null)), [])
  useEffect(() => {
    void load()
  }, [load, key])
  if (!herd || animalIds.length === 0) return null
  const groupOf = new Map(animalIds.map((id) => {
    const m = memberAt(herd, id, date)
    return [id, m ? (herd.groups.find((g) => g.id === m.group_id) ?? null) : null] as const
  }))
  const count = new Map<string, number>()
  for (const g of groupOf.values()) if (g) count.set(g.id, (count.get(g.id) ?? 0) + 1)
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => herd.groups.find((g) => g.id === id)!)
  const target = ranked.find((g) => g.milking) ?? ranked[0] ?? null
  if (!target) return <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Keines der gewogenen Tiere steht in einer Tiergruppe.</p>
  const off = animalIds.filter((id) => groupOf.get(id)?.id !== target.id)
  if (off.length === 0) return <p className="text-sm text-green-800">✓ Alle {animalIds.length} gewogenen Tiere stehen in «{target.name}».</p>
  async function move() {
    setBusy(true)
    try {
      const ids = new Set(off)
      const refs = ((await animalProvider(moduleKey)?.listAnimals()) ?? []).filter((r) => ids.has(r.id))
      await moveAnimals(herd!, { toGroup: target!, fromGroup: null, date, animals: refs, counts: {}, dryOff: false })
      await refreshHerdData()
      await load()
      notifySuccess(`${refs.length} nach «${target!.name}» verschoben`)
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
      <p>
        <b>{off.length} {off.length === 1 ? 'Tier steht' : 'Tiere stehen'} nicht in «{target.name}»</b>, wo die meisten gewogenen Tiere sind:{' '}
        {off.map((id) => {
          const g = groupOf.get(id)
          return `${labels[id] || '?'} (${g ? g.name : 'ohne Gruppe'})`
        }).join(', ')}
      </p>
      {canMove && (
        <button type="button" disabled={busy} onClick={() => void move()} className="min-h-11 rounded-lg border-2 border-amber-600 bg-white px-3 font-semibold text-amber-900 disabled:opacity-50">
          {busy ? 'verschiebe …' : `Alle ${off.length} ab ${fmtDate(date)} nach «${target.name}»`}
        </button>
      )}
    </div>
  )
}
