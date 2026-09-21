import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken } from '@fmis/core/auth'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { useDb } from '@fmis/core/DbContext'
import { upsertRow, softDeleteRow } from '../db/write'
import { getDairySyncClient } from '../db/sync'
import { fmtDate, fmtDateTime, todayIso } from '../lib/format'
import { speciesTerms } from '../lib/species'
import type { Animal, MilkingBank, MilkingSlot } from '../types'

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
}

interface SlotRow extends MilkingSlot {
  animal: Animal | null
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
  const { rows: slots } = await pg.query<MilkingSlot & { a_id: string | null; a_name: string | null; a_lauf_nr: string | null; a_ear_tag: string | null }>(
    `select s.*, a.id as a_id, a.name as a_name, a.lauf_nr as a_lauf_nr, a.ear_tag as a_ear_tag
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
      })),
  }))
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
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
  const [date, setDate] = useState(todayIso())
  const { data, refresh } = useQuery((db) => loadBanks(db, date), [date])
  const [readerEnabled, setReaderEnabled] = useState<boolean | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capacity, setCapacity] = useState(12)
  const [manualInput, setManualInput] = useState('')
  const [openArchived, setOpenArchived] = useState<Record<string, boolean>>({})
  const esRef = useRef<AbortController | null>(null)

  const banks = data ?? []
  const openBank = useMemo(() => [...banks].reverse().find((b) => !b.bank.closed_at) ?? null, [banks])
  const archived = banks.filter((b) => b.bank.closed_at)

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
            const state = JSON.parse(line.slice(6)) as SessionState
            setSession(state)
            void syncClient.syncNow()
          }
        }
      } catch {
        // abgebrochen (Seite verlassen) oder offline — Sync-Loop läuft weiter
      }
    })()
    return () => controller.abort()
  }, [moduleKey])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
  const nextBank = () =>
    run(async () => {
      if (session?.active) {
        setSession(await api<SessionState>(`/${moduleKey}/reader/session/next-bank`, 'POST'))
        await syncClient.syncNow()
      } else if (openBank) {
        // Ohne Server-Sitzung (manuelle Erfassung): Bank lokal schliessen
        await upsertRow(pg, 'milking_banks', { ...openBank.bank, closed_at: new Date().toISOString() })
        refresh()
      }
    })

  /** Manuelle Aufnahme (ohne Leser): Laufnummer oder Ohrmarke — offline möglich. */
  async function addManual() {
    const q = manualInput.trim()
    if (!q) return
    await run(async () => {
      const { rows } = await pg.query<Animal>(
        `select * from animals where deleted_at is null and (lauf_nr = $1 or ear_tag = $1 or ear_tag like $2) order by status limit 1`,
        [q, `%${q}`],
      )
      const animal = rows[0] ?? null
      let bank = openBank?.bank ?? null
      let count = openBank?.slots.length ?? 0
      if (!bank || count >= bank.capacity) {
        if (bank) await upsertRow(pg, 'milking_banks', { ...bank, closed_at: new Date().toISOString() })
        bank = {
          id: crypto.randomUUID(),
          session_date: date,
          bank_number: banks.length + 1,
          capacity,
          opened_at: new Date().toISOString(),
          closed_at: null,
          notes: null,
        } as MilkingBank
        await upsertRow(pg, 'milking_banks', bank)
        count = 0
      }
      await upsertRow(pg, 'milking_slots', {
        id: crypto.randomUUID(),
        bank_id: bank.id,
        position: count + 1,
        original_position: count + 1,
        transponder: null,
        ear_tag: animal?.ear_tag ?? q,
        animal_id: animal?.id ?? null,
        weighed: false,
        notes: null,
        read_at: new Date().toISOString(),
      })
      setManualInput('')
      refresh()
    })
  }

  const onChanged = useCallback(() => refresh(), [refresh])

  if (readerEnabled === null) return <div className="p-4 text-center text-gray-400">Lädt…</div>

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Milchwägung</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </div>

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
            {!session?.active && (
              <label className="flex items-center gap-1 text-xs text-gray-600">
                Plätze
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value) || 12)}
                  className="w-14 rounded border border-gray-300 px-1.5 py-1 text-sm"
                />
              </label>
            )}
            {canWrite &&
              (session?.active ? (
                <button type="button" onClick={stop} disabled={busy} className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700">
                  Leser trennen
                </button>
              ) : (
                <button type="button" onClick={start} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">
                  Leser verbinden
                </button>
              ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Ohrmarkenleser für diese Instanz nicht aktiviert (Verwaltung → Module) — manuelle Aufnahme unten.</p>
        )}
        {session?.last_error && <p className="mt-2 text-sm text-red-600">{session.last_error}</p>}
        {session?.active && session.session_date && session.session_date !== date && (
          <p className="mt-2 text-xs text-amber-700">Die laufende Sitzung gehört zum {fmtDate(session.session_date)}.</p>
        )}
        <p className="mt-2 text-xs text-gray-400">
          Die Sitzung läuft auf dem Server — die Seite darf verlassen werden, der Leser liest weiter. Ist eine Bank voll,
          beginnt automatisch die nächste.
        </p>
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {/* Aktuelle Bank */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-gray-800">
          {openBank ? `Bank ${openBank.bank.bank_number}` : 'Keine offene Bank'}
          {openBank && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              {openBank.slots.length} / {openBank.bank.capacity} · {openBank.slots.filter((s) => s.weighed).length} gewogen
            </span>
          )}
        </h2>
        {canWrite && openBank && openBank.slots.length > 0 && (
          <button type="button" onClick={nextBank} disabled={busy} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white">
            Nächste Bank →
          </button>
        )}
      </div>
      {openBank ? (
        <BankTable bank={openBank} terms={terms} canWrite={canWrite} onChanged={onChanged} />
      ) : (
        <p className="text-center text-sm text-gray-400">
          {session?.active ? 'Warte auf die erste Lesung…' : 'Leser verbinden oder unten manuell aufnehmen.'}
        </p>
      )}

      {canWrite && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addManual()
          }}
        >
          <input
            type="text"
            placeholder="Manuell: Laufnummer oder Ohrmarke"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button type="submit" disabled={busy || !manualInput.trim()} className="rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-700 disabled:opacity-50">
            Aufnehmen
          </button>
        </form>
      )}

      {/* Archiv */}
      {archived.length > 0 && (
        <div className="space-y-2">
          <h2 className="pt-2 text-lg font-bold text-gray-800">Abgeschlossene Bänke</h2>
          {[...archived].reverse().map((b) => (
            <div key={b.bank.id} className="rounded-lg bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setOpenArchived((o) => ({ ...o, [b.bank.id]: !o[b.bank.id] }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
              >
                <span className="font-semibold text-gray-800">Bank {b.bank.bank_number}</span>
                <span className="text-xs text-gray-500">
                  {b.slots.length} {terms.plural} · {b.slots.filter((s) => s.weighed).length} gewogen ·{' '}
                  {fmtDateTime(b.bank.opened_at)}
                  {openArchived[b.bank.id] ? ' ▴' : ' ▾'}
                </span>
              </button>
              {openArchived[b.bank.id] && (
                <div className="border-t p-2">
                  <BankTable bank={b} terms={terms} canWrite={canWrite} onChanged={onChanged} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BankTable({
  bank,
  terms,
  canWrite,
  onChanged,
}: {
  bank: BankWithSlots
  terms: ReturnType<typeof speciesTerms>
  canWrite: boolean
  onChanged: () => void
}) {
  const pg = useDb()
  const [editing, setEditing] = useState(false)
  const [order, setOrder] = useState<SlotRow[]>([])
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
  async function saveOrder() {
    for (let i = 0; i < order.length; i++) {
      const s = order[i]
      if (s.position !== i + 1) {
        const { animal: _a, ...row } = s
        await upsertRow(pg, 'milking_slots', { ...row, position: i + 1 })
      }
    }
    setEditing(false)
    onChanged()
  }

  async function toggleWeighed(s: SlotRow) {
    const { animal: _a, ...row } = s
    await upsertRow(pg, 'milking_slots', { ...row, weighed: !s.weighed })
    onChanged()
  }

  async function removeSlot(s: SlotRow) {
    if (!confirm(`${label(s)} aus der Bank entfernen?`)) return
    await softDeleteRow(pg, 'milking_slots', s.id)
    onChanged()
  }

  function openNote(s: SlotRow) {
    setNoteFor(s.id)
    setNoteText(s.notes ?? '')
  }
  async function saveNote(s: SlotRow) {
    const text = noteText.trim()
    const { animal: _a, ...row } = s
    await upsertRow(pg, 'milking_slots', { ...row, notes: text || null })
    // Ins Journal des Tiers kopieren (1:1 über ref_id = Slot; leer = löschen)
    if (s.animal_id) {
      const { rows } = await pg.query<{ id: string }>(
        'select id from animal_journal where ref_id = $1 and deleted_at is null',
        [s.id],
      )
      if (text) {
        await upsertRow(pg, 'animal_journal', {
          id: rows[0]?.id ?? crypto.randomUUID(),
          animal_id: s.animal_id,
          entry_date: bank.bank.session_date,
          source: 'milchwaegung',
          text: `Milchwägung Bank ${bank.bank.bank_number}: ${text}`,
          ref_id: s.id,
        })
      } else if (rows[0]) {
        await softDeleteRow(pg, 'animal_journal', rows[0].id)
      }
    }
    setNoteFor(null)
    onChanged()
  }

  function label(s: SlotRow): string {
    return s.animal?.lauf_nr ?? s.animal?.name ?? s.ear_tag ?? s.transponder ?? '?'
  }

  const rows = editing ? order : [...slots].sort((a, b) => a.position - b.position)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2 text-xs">
        {editing ? (
          <>
            <button type="button" onClick={() => setEditing(false)} className="rounded px-2 py-1 text-gray-600">
              Abbrechen
            </button>
            <button type="button" onClick={saveOrder} className="rounded bg-brand-700 px-3 py-1 font-medium text-white">
              Reihenfolge speichern
            </button>
          </>
        ) : (
          canWrite &&
          slots.length > 1 && (
            <button type="button" onClick={startEdit} title="Reihenfolge nachträglich anpassen" className="rounded px-2 py-1 text-brand-700">
              ✎ Umsortieren
            </button>
          )
        )}
      </div>
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              {editing && <th className="px-2 py-2">Gelesen</th>}
              <th className="w-8 px-2 py-2" />
              <th className="px-2 py-2">Nr.</th>
              <th className="px-2 py-2">{terms.singular}</th>
              <th className="px-2 py-2">Notiz</th>
              {editing && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, idx) => (
              <tr key={s.id} className={`border-b last:border-0 ${s.weighed ? 'bg-green-50' : ''}`}>
                {editing && (
                  <td className="px-2 py-1 align-top text-xs text-gray-400">
                    {byOriginal[idx] ? `${byOriginal[idx].original_position}. ${label(byOriginal[idx])}` : ''}
                  </td>
                )}
                <td className="px-2 py-1 align-middle">
                  <input
                    type="checkbox"
                    checked={s.weighed}
                    disabled={!canWrite || editing}
                    onChange={() => toggleWeighed(s)}
                    className="h-5 w-5"
                    title="gewogen"
                  />
                </td>
                <td className="px-2 py-1 align-middle">
                  <span className="text-2xl font-bold leading-none text-gray-800">{s.animal?.lauf_nr ?? '–'}</span>
                  <span className="ml-1 text-[10px] text-gray-400">{editing ? idx + 1 : s.position}.</span>
                </td>
                <td className="px-2 py-1 align-middle">
                  <div className="text-sm font-medium text-gray-800">
                    {s.animal?.name ?? (s.animal ? '' : <span className="text-amber-700">unbekannt</span>)}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {s.ear_tag ?? ''}
                    {s.transponder && s.transponder !== s.ear_tag ? ` · ${s.transponder}` : ''}
                  </div>
                </td>
                <td className="px-2 py-1 align-middle">
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
                      <button type="submit" className="rounded bg-brand-700 px-2 py-1 text-xs text-white">
                        OK
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => canWrite && openNote(s)}
                      className="flex items-center gap-1 text-left text-xs text-gray-600"
                      title="Notiz zur Wägung (wird ins Journal des Tiers kopiert)"
                    >
                      <span className="text-gray-400">✎</span>
                      <span className={s.notes ? '' : 'text-gray-300'}>{s.notes ?? 'Notiz'}</span>
                    </button>
                  )}
                </td>
                {editing && (
                  <td className="whitespace-nowrap px-2 py-1 align-middle text-xs">
                    <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded px-1.5 py-0.5 text-gray-600 disabled:opacity-30">
                      ▲
                    </button>
                    <button type="button" onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} className="rounded px-1.5 py-0.5 text-gray-600 disabled:opacity-30">
                      ▼
                    </button>
                    <button type="button" onClick={() => removeSlot(s)} className="rounded px-1.5 py-0.5 text-red-500" title="Entfernen">
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={editing ? 6 : 4} className="px-3 py-4 text-center text-gray-400">
                  Noch keine Lesung.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
