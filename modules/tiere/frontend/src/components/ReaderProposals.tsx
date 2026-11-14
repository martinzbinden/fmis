import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { listAllAnimals, type AnimalRef } from '@fmis/core/animals'
import { API_URL, getCurrentUserEmail, getToken } from '@fmis/core/auth'
import { syncModuleNow } from '@fmis/core/sync'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'
import { useQuery } from '../hooks/useQuery'
import { fmtDateTime } from '../lib/format'
import { resolveTags, toProposal, type PoolProposal } from '../lib/groupScan'
import type { HerdData } from '../lib/herds'
import type { HerdGroup } from '../types'
import ScanSaveDialog from './ScanSaveDialog'

async function loadProposals(pg: PGlite): Promise<PoolProposal[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select * from reader_pools where deleted_at is null and status in ('neu', 'bekannt') order by coalesce(scanned_at, fetched_at) desc`,
  )
  return rows.map(toProposal)
}

interface ReaderStatus {
  enabled: boolean
  last_ok_at: number | null
  last_error: string | null
  interval_s: number
  sync_on: boolean
  sync_seconds_left: number
  sync_ttl_s: number
}

interface SyncState {
  sync_on: boolean
  sync_seconds_left: number
  sync_ttl_s: number
}

const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` })

/** Gruppen, die im Lesegerät liegen (auch ohne Empfang gescannt): der Server holt sie ab, sobald das Gerät
 * wieder erreichbar ist, und schlägt sie hier zum Import vor — als neue Gruppe oder als Ersatz einer bestehenden. */
export default function ReaderProposals({ data, canWrite, onImported }: { data: HerdData; canWrite: boolean; onImported: (g: HerdGroup) => void }) {
  const { data: proposals } = useQuery(loadProposals)
  const [animals, setAnimals] = useState<AnimalRef[] | null>(null)
  const [status, setStatus] = useState<ReaderStatus | null>(null)
  const [importing, setImporting] = useState<PoolProposal | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listAllAnimals().then(setAnimals)
  }, [])

  const loadStatus = useCallback(() => {
    fetch(`${API_URL}/tiere/reader/status`, { headers: authHeaders() })
      .then((r) => (r.ok ? (r.json() as Promise<ReaderStatus>) : null))
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])
  useEffect(() => {
    loadStatus()
    const t = setInterval(loadStatus, 60_000)
    return () => clearInterval(t)
  }, [loadStatus])

  // Schalter «Sync»: das Gerät wird nur abgefragt, solange er an ist (es nimmt nur eine Verbindung auf einmal an,
  // AgriLink und die Milchwägung sollen nicht gestört werden). Standard aus; die Seite hält ihn mit einem
  // Herzschlag am Leben, nach einem Arbeitsunterbruch fällt er auf dem Server von selbst auf aus.
  const syncOn = !!status?.sync_on
  async function postSync(on: boolean, renew = false): Promise<SyncState> {
    const res = await fetch(`${API_URL}/tiere/reader/sync`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ on, renew }),
    })
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `Fehler ${res.status}`)
    return (await res.json()) as SyncState
  }
  async function toggleSync() {
    const next = !syncOn
    setStatus((s) => (s ? { ...s, sync_on: next } : s))
    try {
      const r = await postSync(next)
      setStatus((s) => (s ? { ...s, ...r } : s))
      // eingeschaltet: der Server fragt das Gerät sofort ab, die Vorschläge kurz darauf holen
      if (next) setTimeout(() => void syncModuleNow('tiere').then(loadStatus), 4000)
    } catch (e) {
      notifyError(errorText(e))
      loadStatus()
    }
  }
  useEffect(() => {
    if (!syncOn) return
    const beat = () => {
      if (document.hidden) return
      postSync(true, true)
        .then((r) => setStatus((s) => (s ? { ...s, ...r } : s)))
        .catch(() => undefined)
    }
    const t = setInterval(beat, 60_000)
    return () => clearInterval(t)
  }, [syncOn])

  const fresh = useMemo(() => (proposals ?? []).filter((p) => p.status === 'neu'), [proposals])
  const older = useMemo(() => (proposals ?? []).filter((p) => p.status === 'bekannt'), [proposals])

  async function refreshNow() {
    setBusy(true)
    try {
      const res = await fetch(`${API_URL}/tiere/reader/refresh`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `Fehler ${res.status}`)
      const r = (await res.json()) as { ok: boolean; error: string | null; new: number }
      if (!r.ok) notifyError(r.error ?? 'Lesegerät nicht erreichbar')
      else notifySuccess(r.new > 0 ? `${r.new} neue Gruppe(n) auf dem Lesegerät` : 'Keine neuen Gruppen auf dem Lesegerät')
      loadStatus()
      // neue Vorschläge sofort auf dieses Gerät holen
      if (r.ok) await syncModuleNow('tiere')
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function mark(p: PoolProposal, next: 'importiert' | 'verworfen', group?: HerdGroup) {
    const { rows } = await getDb().then((pg) => pg.query<Record<string, unknown>>('select * from reader_pools where id = $1', [p.id]))
    if (!rows[0]) return
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
    await upsertRow('reader_pools', {
      ...rows[0],
      id: p.id,
      fetched_at: iso(rows[0].fetched_at),
      handled_at: new Date().toISOString(),
      status: next,
      handled_by: getCurrentUserEmail(),
      imported_group_id: group?.id ?? null,
      deleted_at: null,
    } as never)
  }

  async function discard(p: PoolProposal) {
    if (!window.confirm(`Gruppe «${p.name ?? p.device_group_id}» vom Lesegerät nicht importieren?`)) return
    try {
      await mark(p, 'verworfen')
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  const reachable = status?.enabled
  if (!canWrite || (!reachable && fresh.length === 0 && older.length === 0)) return null

  const importingResolved = importing && animals ? resolveTags(importing.tags, animals) : null

  return (
    <section className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm" aria-label="Vom Lesegerät">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-sky-950">📥 Vom Lesegerät{fresh.length > 0 ? ` · ${fresh.length} neu` : ''}</h2>
        {reachable && (
          <button
            type="button"
            role="switch"
            aria-checked={syncOn}
            onClick={() => void toggleSync()}
            className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-sky-950"
            title="Das Gerät wird nur abgefragt, solange der Sync an ist. Er schaltet sich nach einem Arbeitsunterbruch von selbst aus."
          >
            <span className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors ${syncOn ? 'bg-sky-700' : 'bg-gray-400'}`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${syncOn ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
            <span className="text-sm font-medium">Sync {syncOn ? 'ein' : 'aus'}</span>
          </button>
        )}
        {reachable && (
          <button type="button" disabled={busy} onClick={() => void refreshNow()} className="min-h-11 rounded-lg border border-sky-700 bg-white px-3 text-sky-900 disabled:opacity-50">
            {busy ? 'fragt …' : 'Jetzt abfragen'}
          </button>
        )}
      </div>
      {status && reachable && (
        <p className="text-xs text-sky-900/80">
          {status.last_ok_at ? `Zuletzt erreicht ${fmtDateTime(new Date(status.last_ok_at * 1000).toISOString())}` : 'Noch nicht erreicht'}
          {status.last_error ? ` · zuletzt: ${status.last_error}` : ''}.{' '}
          {syncOn
            ? `Sync ein: das Gerät wird alle ${Math.round(status.interval_s / 60)} Min. abgefragt, solange diese Seite offen ist (nach ${Math.round(status.sync_ttl_s / 60)} Min. ohne Arbeit schaltet er sich aus).`
            : 'Sync aus: das Gerät wird nicht im Hintergrund abgefragt, so stört FMIS AgriLink nicht. Einschalten, wenn du mit Tierlisten und dem Lesegerät arbeitest.'}
        </p>
      )}

      {fresh.length === 0 && <p className="text-sky-900">Keine neuen Gruppen auf dem Gerät.</p>}
      <ul className="space-y-2">
        {fresh.map((p) => (
          <ProposalRow key={p.id} p={p} animals={animals} onImport={() => setImporting(p)} onDiscard={() => void discard(p)} />
        ))}
      </ul>

      {older.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-sky-900">Ältere Gruppen auf dem Gerät ({older.length})</summary>
          <p className="text-xs text-sky-900/80">Lagen schon beim ersten Abgleich im Gerät und wurden darum nicht als neu vorgeschlagen.</p>
          <ul className="mt-1 space-y-2">
            {older.map((p) => (
              <ProposalRow key={p.id} p={p} animals={animals} onImport={() => setImporting(p)} onDiscard={() => void discard(p)} />
            ))}
          </ul>
        </details>
      )}

      {importing && importingResolved && (
        <ScanSaveDialog
          data={data}
          resolved={importingResolved}
          source={`Gruppe vom Lesegerät (${importing.name ?? importing.device_group_id})`}
          defaultName={importing.name ?? undefined}
          onClose={() => setImporting(null)}
          onSaved={(g) => {
            const p = importing
            setImporting(null)
            void mark(p, 'importiert', g).catch((e: unknown) => notifyError(errorText(e)))
            onImported(g)
          }}
        />
      )}
    </section>
  )
}

function ProposalRow({ p, animals, onImport, onDiscard }: { p: PoolProposal; animals: AnimalRef[] | null; onImport: () => void; onDiscard: () => void }) {
  const r = animals ? resolveTags(p.tags, animals) : null
  return (
    <li className="space-y-1 rounded-lg bg-white p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-900">{p.name ?? `Gruppe ${p.device_group_id}`}</span>
        <span className="text-xs text-gray-600">{p.scanned_at ? `gescannt ${fmtDateTime(p.scanned_at)}` : `geholt ${fmtDateTime(p.fetched_at)}`}</span>
      </div>
      <p className="text-gray-800">
        {r ? (
          <>
            {r.matched.length} {r.matched.length === 1 ? 'Tier' : 'Tiere'} erkannt
            {r.unknown.length + p.unmatched.length > 0 && <span className="text-amber-800">, {r.unknown.length + p.unmatched.length} nicht zuordenbar</span>}
          </>
        ) : (
          `${p.tag_count} Ohrmarken`
        )}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={!r || r.matched.length === 0} onClick={onImport} className="min-h-11 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50">
          Prüfen und importieren
        </button>
        <button type="button" onClick={onDiscard} className="min-h-11 rounded-lg border border-gray-300 px-3 text-gray-700">
          Verwerfen
        </button>
      </div>
    </li>
  )
}
