import { useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { notifyError, notifySuccess, errorText } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { getSyncedDb as getFieldsDb } from '@fmis/fields/db/access'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow, upsertRow } from '../db/write'

export interface FarmNumber {
  id: string
  farm: string | null
  label: string
  value: string
  notes: string | null
  sort_order: number
}

interface GelanFarm {
  name: string
  external_uid: string | null
  bur_nr: string | null
}

// Vorschläge für die Bezeichnung — die Nummern selbst trägt man ein
const LABEL_SUGGESTIONS = [
  'Betriebsnummer Kanton',
  'TVD-Betriebsnummer',
  'Herdebuch-Betriebsnummer',
  'Milchkäufer-Lieferantennummer',
  'MWST-Nummer',
  'Tierseuchenkasse',
]

async function load(pg: PGlite): Promise<{ numbers: FarmNumber[]; gelan: GelanFarm[] }> {
  const { rows: numbers } = await pg.query<FarmNumber>(
    'select id, farm, label, value, notes, sort_order from farm_numbers where deleted_at is null order by sort_order, farm nulls first, label',
  )
  // UID und BUR-Nummer aus dem GELAN-Import (Modul Kulturen); ohne das Modul nichts
  let gelan: GelanFarm[] = []
  try {
    const fields = await getFieldsDb()
    gelan = (await fields.query<GelanFarm>('select name, external_uid, bur_nr from farms where deleted_at is null order by name')).rows
  } catch {
    // Modul Kulturen nicht verfügbar
  }
  return { numbers, gelan }
}

/** CHE123456789 → CHE-439.865.378 (Schreibweise im UID-Register). */
export function formatUid(uid: string): string {
  const m = /^CHE-?(\d{3})\.?(\d{3})\.?(\d{3})$/.exec(uid.trim())
  return m ? `CHE-${m[1]}.${m[2]}.${m[3]}` : uid
}

/** In die Zwischenablage; wo der Browser das sperrt (eingebettete Ansicht, ältere
 * Handys), die Nummer markieren und auf dem alten Weg kopieren. */
async function copyText(el: HTMLElement, value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
}

function CopyValue({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        const el = e.currentTarget.querySelector('span') as HTMLElement
        void copyText(el, value).then((ok) =>
          ok ? notifySuccess(`Kopiert: ${value}`) : notifyError('Kopieren ging nicht — die Nummer ist markiert, bitte von Hand kopieren.'),
        )
      }}
      className="flex min-h-11 items-center gap-2 text-left"
      title="Antippen zum Kopieren"
    >
      <span className="select-all font-mono text-lg font-semibold text-gray-900">{value}</span>
      <span className="text-sm text-gray-400" aria-hidden>
        ⧉
      </span>
    </button>
  )
}

const empty = (): Omit<FarmNumber, 'id'> & { id: string | null } => ({ id: null, farm: null, label: '', value: '', notes: null, sort_order: 0 })

/** Betriebsdaten: Nummern für Formulare und Ämter an einem Ort, zum Kopieren. */
export default function FarmData() {
  const { data, loading } = useQuery(load, [])
  const canWrite = useHasPermission('betrieb:dienste:write')
  const [edit, setEdit] = useState<ReturnType<typeof empty> | null>(null)
  const numbers = data?.numbers ?? []
  const gelan = data?.gelan ?? []
  const farmNames = [...new Set([...gelan.map((g) => g.name), ...numbers.map((n) => n.farm).filter((f): f is string => !!f)])]

  async function save() {
    if (!edit) return
    const label = edit.label.trim()
    const value = edit.value.trim()
    if (!label || !value) {
      notifyError('Bezeichnung und Nummer angeben.')
      return
    }
    const row = { ...edit, id: edit.id ?? crypto.randomUUID(), label, value, farm: edit.farm?.trim() || null, notes: edit.notes?.trim() || null }
    try {
      await undoAction(`Betriebsnummer ${label}`, () => upsertRow('farm_numbers', row as never))
      setEdit(null)
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  async function remove(n: FarmNumber) {
    try {
      await undoAction(`Betriebsnummer ${n.label} gelöscht`, () => softDeleteRow('farm_numbers', n.id))
      setEdit(null)
    } catch (e) {
      notifyError(errorText(e))
    }
  }

  const input = 'min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base'

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Betriebsdaten</h1>
        <p className="text-sm text-gray-500">Nummern für Formulare, Ämter und Anrufe. Antippen kopiert die Nummer.</p>
      </div>

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Nummern</h2>
          {canWrite && !edit && (
            <button type="button" onClick={() => setEdit(empty())} className="link-btn text-sm font-medium text-brand-700">
              + Nummer erfassen
            </button>
          )}
        </div>
        {data && numbers.length === 0 && !edit && (
          <p className="rounded-lg bg-white p-4 text-sm text-gray-500 shadow-sm">
            Noch keine Nummern erfasst{canWrite ? ' — z.B. die kantonale Betriebsnummer (BE…) mit «+ Nummer erfassen».' : '.'}
          </p>
        )}
        <ul className="space-y-2">
          {numbers.map((n) =>
            edit?.id === n.id ? null : (
              <li key={n.id} className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-600">
                      {n.label}
                      {n.farm && <span className="text-gray-400"> · {n.farm}</span>}
                    </div>
                    <CopyValue value={n.value} />
                    {n.notes && <div className="text-xs text-gray-500">{n.notes}</div>}
                  </div>
                  {canWrite && (
                    <button type="button" onClick={() => setEdit({ ...n })} className="link-btn shrink-0 text-sm text-brand-700">
                      ✎ ändern
                    </button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>

        {edit && (
          <form
            className="space-y-3 rounded-lg border-2 border-brand-200 bg-white p-3 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label className="block text-sm text-gray-700">
              Bezeichnung
              <input list="farm-number-labels" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} className={input} autoFocus />
              <datalist id="farm-number-labels">
                {LABEL_SUGGESTIONS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
            <label className="block text-sm text-gray-700">
              Nummer
              <input value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} className={`${input} font-mono`} autoCapitalize="characters" spellCheck={false} />
            </label>
            {farmNames.length > 1 && (
              <label className="block text-sm text-gray-700">
                Betriebsteil
                <select value={edit.farm ?? ''} onChange={(e) => setEdit({ ...edit, farm: e.target.value || null })} className={`${input} bg-white`}>
                  <option value="">ganzer Betrieb</option>
                  {farmNames.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm text-gray-700">
              Bemerkung (optional)
              <input value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className={input} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">
                Speichern
              </button>
              <button type="button" onClick={() => setEdit(null)} className="min-h-11 rounded-lg px-3 text-sm text-gray-600">
                Abbrechen
              </button>
              {edit.id && (
                <button type="button" onClick={() => void remove(edit as FarmNumber)} className="ml-auto min-h-11 rounded-lg px-3 text-sm text-red-700">
                  Löschen
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      {gelan.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Aus dem GELAN-Import</h2>
          <ul className="space-y-2">
            {gelan.map((g) => (
              <li key={g.name} className="rounded-lg bg-white p-3 shadow-sm">
                <div className="font-semibold text-gray-800">{g.name}</div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3 text-sm">
                  {g.external_uid && (
                    <>
                      <dt className="text-gray-500">UID</dt>
                      <dd>
                        <CopyValue value={formatUid(g.external_uid)} />
                      </dd>
                    </>
                  )}
                  {g.bur_nr && (
                    <>
                      <dt className="text-gray-500">BUR-Nr.</dt>
                      <dd>
                        <CopyValue value={g.bur_nr} />
                      </dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500">Kommt mit dem Import der GELAN-Raumdaten; hier nicht änderbar.</p>
        </section>
      )}
    </div>
  )
}
