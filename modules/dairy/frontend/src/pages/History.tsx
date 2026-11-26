import { useMemo, useState } from 'react'
import HistoryUndoButton from '@fmis/core/HistoryUndoButton'
import { TABLE_LABELS } from '@fmis/core/undo'
import { SessionUndoList } from '@fmis/core/UndoBar'
import { restoreRowState } from '../db/write'
import { useDb } from '@fmis/core/DbContext'
import { useServerHistory } from '@fmis/core/historyApi'
import { Link } from 'react-router-dom'
import { fmtDateTime } from '../lib/format'
import { speciesTerms } from '../lib/species'
import type { DataHistory, HistoryAction } from '../types'
import { animalLabel, shortEarTag } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { fmtDate } from '../lib/format'
import { RESULT_LABEL } from '../lib/pregnancy'

const TABLE_LABEL: Record<string, string> = {
  milk_tests: 'Milchtest',
}

const ACTION_LABEL: Record<HistoryAction, string> = {
  insert: 'Neu',
  update: 'Geändert',
  delete: 'Gelöscht',
}

const ACTION_COLOR: Record<HistoryAction, string> = {
  insert: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
}

/** Was der Verlauf zum Beschriften braucht: Tiere (Laufnummer/Ohrmarke/Name), Bänke, Geburten (Mutter). */
interface Lookup {
  animal: Map<string, { lauf_nr: string | null; ear_tag: string; name: string | null }>
  bank: Map<string, { bank_number: number; session_date: string }>
  birth: Map<string, { dam_id: string; birth_date: string }>
}

async function loadLookup(db: import('@electric-sql/pglite').PGlite): Promise<Lookup> {
  const [a, b, br] = await Promise.all([
    db.query<{ id: string; lauf_nr: string | null; ear_tag: string; name: string | null }>('select id, lauf_nr, ear_tag, name from animals'),
    db.query<{ id: string; bank_number: number; session_date: unknown }>('select id, bank_number, session_date from milking_banks'),
    db.query<{ id: string; dam_id: string; birth_date: unknown }>('select id, dam_id, birth_date from births'),
  ])
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))
  return {
    animal: new Map(a.rows.map((r) => [r.id, r])),
    bank: new Map(b.rows.map((r) => [r.id, { bank_number: r.bank_number, session_date: iso(r.session_date) }])),
    birth: new Map(br.rows.map((r) => [r.id, { dam_id: r.dam_id, birth_date: iso(r.birth_date) }])),
  }
}

const JOURNAL_LABEL: Record<string, string> = { notiz: 'Notiz', beobachtung: 'Beobachtung', krankheit: 'Krankheit', behandlung: 'Behandlung', brunst: 'Brunst', klauen: 'Klauen', trocken: 'Trockengestellt', fuetterung: 'Fütterung' }

/** Extrahiert eine sprechende Kurzbeschreibung + optionalen Detail-Link aus dem Snapshot. Tiere mit Laufnummer, sonst
 * kurzer Ohrmarke; der Name nur, wenn es einen gibt. */
function describeEntry(entry: DataHistory, moduleKey: string, lk?: Lookup): { label: string; link: string | null } {
  let snap: Record<string, unknown> = {}
  try {
    snap = JSON.parse(entry.snapshot)
  } catch {
    // Snapshot sollte immer valides JSON sein (schreibt nur write.ts) — falls
    // doch nicht, einfach ohne Detaillabel weitermachen.
  }
  const s = (v: unknown) => (v == null ? null : String(v))
  const day = (v: unknown) => (v ? fmtDate(String(v).slice(0, 10)) : '?')
  /** Tier aus der Liste (Laufnummer · Name), sonst kurze Ohrmarke aus dem Snapshot */
  const tier = (id: unknown, earTag?: unknown): string => {
    const a = id ? lk?.animal.get(String(id)) : undefined
    if (a) return [a.lauf_nr ?? shortEarTag(a.ear_tag), a.name].filter(Boolean).join(' ')
    return earTag ? shortEarTag(String(earTag)) : 'Tier ?'
  }
  const tierLink = (id: unknown) => (id ? `/${moduleKey}/tiere/${String(id)}` : null)
  const kg = (v: unknown) => (v == null || v === '' ? null : `${Number(v).toLocaleString('de-CH', { maximumFractionDigits: 2 })} kg`)

  switch (entry.table_name) {
    case 'milking_banks':
      return { label: `Bank ${s(snap.bank_number) ?? '?'} vom ${day(snap.session_date)}${snap.closed_at ? ' · abgeschlossen' : ' · offen'}`, link: `/${moduleKey}/milchwaegung` }
    case 'milking_slots': {
      const b = snap.bank_id ? lk?.bank.get(String(snap.bank_id)) : undefined
      const where = b ? `Bank ${b.bank_number} vom ${fmtDate(b.session_date)}, Platz ${s(snap.position) ?? '?'}` : `Platz ${s(snap.position) ?? '?'}`
      return { label: [tier(snap.animal_id, snap.ear_tag), where, kg(snap.milk_kg)].filter(Boolean).join(' · '), link: tierLink(snap.animal_id) }
    }
    case 'births':
      return { label: `Geburt: ${tier(snap.dam_id)} am ${day(snap.birth_date)}`, link: tierLink(snap.dam_id) }
    case 'birth_offspring': {
      const br = snap.birth_id ? lk?.birth.get(String(snap.birth_id)) : undefined
      const sex = snap.sex === 'w' ? '♀' : snap.sex === 'm' ? '♂' : ''
      const dead = snap.stillborn ? ' † tot geboren' : snap.died_24h ? ' † verendet' : snap.died_on ? ` † ${day(snap.died_on)}` : ''
      return { label: `Nachkomme ${sex} ${snap.ear_tag ? shortEarTag(String(snap.ear_tag)) : 'ohne Ohrmarke'}${dead}${br ? ` · Mutter ${tier(br.dam_id)}, ${fmtDate(br.birth_date)}` : ''}`.replace(/\s+/g, ' '), link: br ? tierLink(br.dam_id) : null }
    }
    case 'matings':
      return { label: `Belegung: ${tier(snap.animal_id)} am ${day(snap.service_date)}${snap.sire_name ? ` mit ${s(snap.sire_name)}` : ''}`, link: tierLink(snap.animal_id) }
    case 'pregnancy_checks':
      return { label: `Trächtigkeit: ${tier(snap.animal_id)} ${RESULT_LABEL[snap.result as keyof typeof RESULT_LABEL] ?? s(snap.result) ?? ''} am ${day(snap.check_date)}`, link: tierLink(snap.animal_id) }
    case 'animal_journal':
      return { label: `${JOURNAL_LABEL[s(snap.category) ?? ''] ?? 'Journal'}: ${tier(snap.animal_id, snap.ear_tag)}${snap.diagnosis ? ` · ${s(snap.diagnosis)}` : snap.text ? ` · ${String(snap.text).slice(0, 60)}` : ''}`, link: tierLink(snap.animal_id) }
    case 'weanings':
      return { label: `Absetzen: ${tier(snap.animal_id)} am ${day(snap.wean_date)}`, link: tierLink(snap.animal_id) }
    case 'animal_weights':
      return { label: `Gewicht: ${tier(snap.animal_id)} ${kg(snap.weight_kg) ?? ''} am ${day(snap.weigh_date)}`, link: tierLink(snap.animal_id) }
    case 'carcass_estimates':
      return { label: `Schlachtwert: ${tier(snap.animal_id)} ${snap.kind === 'chtax' ? `CH-TAX ${s(snap.fleshiness) ?? ''}${s(snap.fat_class) ?? ''}` : `${kg(snap.weight_kg) ?? ''} ${snap.basis === 'sg' ? 'SG' : 'lebend'} (${s(snap.method) ?? ''})`} am ${day(snap.estimate_date)}`, link: tierLink(snap.animal_id) }
    case 'watchlists':
      return { label: `Merkliste «${s(snap.name) ?? '?'}»`, link: `/${moduleKey}/merklisten` }
    case 'watchlist_entries':
      return { label: `Auf Merkliste: ${tier(snap.animal_id)}${snap.reason ? ` · ${s(snap.reason)}` : ''}`, link: tierLink(snap.animal_id) }
    case 'stall_decisions': {
      const what = snap.step === 'milchzusatz' ? 'Milchzusatz' : 'Eimer'
      const dec: Record<string, string> = { eimer: 'am Eimer', mutter: 'wieder bei der Mutter', spaeter: 'später', erledigt: 'erledigt' }
      return { label: `${what}: ${tier(snap.animal_id)} ${dec[s(snap.decision) ?? ''] ?? s(snap.decision) ?? ''} ab ${day(snap.decided_on)}`, link: tierLink(snap.animal_id) }
    }
    case 'culling_marks':
      return { label: `Ausmerzliste: ${tier(snap.animal_id)} ${snap.mark === 'leben' ? '👍 bleibt' : snap.mark === 'schlachten' ? '👎 schlachten' : ''}`, link: tierLink(snap.animal_id) }
    case 'yogurt_batches':
      return { label: `Joghurt-Milch ${day(snap.batch_date)}: ${kg(snap.milk_kg) ?? '?'}`, link: `/${moduleKey}/leistung?ansicht=joghurt` }
    case 'board_views':
      return { label: `Dashboard-Ansicht «${s(snap.name) ?? '?'}»${snap.shared ? ' (für alle)' : ''}`, link: `/${moduleKey}/dashboard` }
    case 'movement_docs':
      return { label: `Begleitdokument ${day(snap.doc_date)}: ${s(snap.animal_count) ?? '?'} Tiere${snap.destination ? ` → ${s(snap.destination)}` : ''}${snap.tvd_reported_on ? ' · TVD gemeldet' : ''}`, link: `/${moduleKey}/tvd` }
    case 'animals':
      return { label: snap.ear_tag ? animalLabel({ ear_tag: String(snap.ear_tag), name: s(snap.name) }) : entry.row_id, link: `/${moduleKey}/tiere/${entry.row_id}` }
    case 'milk_tests':
      return {
        label: `${s(snap.milk_kg) ?? '?'} kg am ${s(snap.test_date) ?? '?'}`,
        link: snap.animal_id ? `/${moduleKey}/tiere/${s(snap.animal_id)}` : null,
      }
    default:
      return { label: entry.row_id, link: null }
  }
}

export default function History({ moduleKey }: { moduleKey: string }) {
  const { entries: data, loading, error, reload } = useServerHistory(moduleKey)
  const db = useDb()
  const tableLabel: Record<string, string> = { animals: speciesTerms(moduleKey).singular, ...TABLE_LABEL }
  const [tableFilter, setTableFilter] = useState('')
  const [search, setSearch] = useState('')

  const entries = data ?? []

  const lookup = useQuery(loadLookup).data
  const decorated = useMemo(
    () =>
      entries.map((e) => {
        let bankId: string | null = null
        if (e.table_name === 'milking_slots') {
          try {
            bankId = (JSON.parse(e.snapshot) as { bank_id?: string }).bank_id ?? null
          } catch {
            bankId = null
          }
        }
        return { entry: e, bankId, ...describeEntry(e, moduleKey, lookup) }
      }),
    [entries, moduleKey, lookup],
  )

  const filtered = decorated.filter(({ entry, label }) => {
    if (tableFilter && entry.table_name !== tableFilter) return false
    if (search && !label.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const availableTables = [...new Set(entries.map((e) => e.table_name))]

  // Milchwägung: Änderungen an Plätzen derselben Bank, von derselben Person, höchstens 15 Min. auseinander → ein Eintrag
  // (aufklappbar). Gespeichert bleibt jede Änderung einzeln, damit jede rückgängig gemacht werden kann.
  type Item = (typeof filtered)[number]
  const items: (Item | { group: Item[] })[] = []
  for (const it of filtered) {
    const last = items[items.length - 1]
    const prev = last && ('group' in last ? last.group[last.group.length - 1] : last)
    const fits =
      prev &&
      it.bankId &&
      prev.bankId === it.bankId &&
      prev.entry.changed_by === it.entry.changed_by &&
      Math.abs(Date.parse(prev.entry.changed_at) - Date.parse(it.entry.changed_at)) <= 15 * 60_000
    if (fits && last) {
      if ('group' in last) last.group.push(it)
      else items[items.length - 1] = { group: [last, it] }
    } else items.push(it)
  }
  const bankTitle = (bankId: string | null) => {
    const b = bankId ? lookup?.bank.get(bankId) : undefined
    return b ? `Bank ${b.bank_number} vom ${fmtDate(b.session_date)}` : 'Milchwägung'
  }
  const one = ({ entry, label, link }: Item, nested = false) => (
    <li key={entry.id} className={nested ? 'border-t py-2' : 'rounded-lg bg-white p-3 shadow-sm'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">{tableLabel[entry.table_name] ?? TABLE_LABELS[entry.table_name] ?? entry.table_name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLOR[entry.action]}`}>{ACTION_LABEL[entry.action]}</span>
      </div>
      <div className="mt-1 font-semibold text-gray-800">
        {link ? (
          <Link to={link} className="text-brand-700">
            {label}
          </Link>
        ) : (
          label
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          {fmtDateTime(entry.changed_at)} · {entry.changed_by ?? 'unbekannt'}
        </span>
        <HistoryUndoButton moduleKey={moduleKey} entry={entry} restore={(t, id, state) => restoreRowState(db, t, id, state)} />
      </div>
    </li>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Verlauf</h1>
      <SessionUndoList source={moduleKey} title="In dieser Sitzung" />

      <div className="flex gap-2">
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Alle Bereiche</option>
          {availableTables.map((t) => (
            <option key={t} value={t}>
              {tableLabel[t] ?? TABLE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Suche…"
          aria-label="Verlauf durchsuchen"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800">
          <p>{error}</p>
          <p className="mt-1 text-xs text-amber-700">
            Der Verlauf wird vom Server gelesen und ist deshalb offline nicht verfügbar.
          </p>
          <button type="button" onClick={reload} className="link-btn mt-2 rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-white">
            Nochmals versuchen
          </button>
        </div>
      )}
      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}
      {data && filtered.length === 0 && (
        <p className="text-center text-gray-500">Keine Einträge.</p>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          if (!('group' in item)) return one(item)
          const g = item.group
          const places = new Set(g.map((x) => x.entry.row_id)).size
          const first = g[g.length - 1].entry.changed_at
          const lastAt = g[0].entry.changed_at
          return (
            <li key={`g-${g[0].entry.id}`} className="rounded-lg bg-white p-3 shadow-sm">
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-500">Milchwägung</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">{g.length} Änderungen</span>
                  </div>
                  <div className="mt-1 font-semibold text-gray-800">
                    {bankTitle(g[0].bankId)}: {places} {places === 1 ? 'Platz' : 'Plätze'}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {fmtDateTime(first)}
                    {fmtDateTime(first) !== fmtDateTime(lastAt) ? ` – ${fmtDateTime(lastAt).slice(-5)}` : ''} · {g[0].entry.changed_by ?? 'unbekannt'} · <span className="text-brand-700">▸ einzeln anzeigen</span>
                  </div>
                </summary>
                <ul className="mt-2">{g.map((x) => one(x, true))}</ul>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
