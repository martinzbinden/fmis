import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { animalKey, shortEarTag } from '@fmis/core/earTag'
import { openImport } from '@fmis/core/importModal'
import Modal from '@fmis/core/Modal'
import { errorText, notifyError } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow, upsertRow, writeBatch } from '../db/write'
import type { PGlite } from '@electric-sql/pglite'
import PenButton from '../components/PenButton'
import { useDb } from '@fmis/core/DbContext'
import { closeMemberships, loadOpenMemberships } from '../lib/groups'
import { fmtDate, todayIso } from '../lib/format'
import {
  ageAt,
  byAge,
  byClassification,
  byLactation,
  bySeason,
  bySex,
  CATEGORIES,
  deliveries,
  lactationDaysAt,
  loadAnimalInfo,
  loadSlaughterRecords,
  stats,
  stillActiveAnimals,
  type Group,
  type StillActive,
  type SlaughterRecord,
} from '../lib/slaughterRecords'

const fr = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Schlachtungen aller Tiere (Lämmer, Schafe, Kälber, Rinder …) aus den Abrechnungen: Lieferungen, Auswertungen nach
 * Alter, Laktationstagen, Jahreszeit, Geschlecht und Taxation, die einzelnen Tiere. */
interface MastAnimal {
  id: string
  ear_tag: string
  status: string
}

export default function Slaughterings() {
  const { data } = useQuery(async (pg) => {
    const [records, info, animals] = await Promise.all([
      loadSlaughterRecords(pg),
      loadAnimalInfo(pg),
      pg.query<MastAnimal>('select id, ear_tag, status from animals where deleted_at is null').then((r) => r.rows),
    ])
    return { records, info, animals }
  })
  const records = data?.records ?? []
  const info = data?.info ?? new Map()
  // Ohrmarke → Tierseite im Mastplaner (über animal_key)
  const mastIdByKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of data?.animals ?? []) {
      const k = animalKey(a.ear_tag)
      if (k) m.set(k, a.id)
    }
    return m
  }, [data?.animals])
  const stillActive = useMemo(() => stillActiveAnimals(records, data?.animals ?? []), [records, data?.animals])
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingRecord = editingId ? (records.find((r) => r.id === editingId) ?? null) : null
  const years = useMemo(() => [...new Set(records.map((r) => r.slaughter_date.slice(0, 4)))].sort().reverse(), [records])
  const cats = useMemo(() => CATEGORIES.filter((c) => records.some((r) => r.category === c)), [records])
  const [year, setYear] = useState('')
  const [cat, setCat] = useState('')
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const shown = records.filter((r) => (!year || r.slaughter_date.startsWith(year)) && (!cat || r.category === cat))
  const lambs = shown.filter((r) => r.category === 'Lamm')
  const ewes = shown.filter((r) => r.category === 'Schaf')
  const chip = (on: boolean) => `min-h-10 rounded-full border px-3 text-sm ${on ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700'}`

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Schlachtungen</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/livestock/mastauswertung" className="inline-flex min-h-10 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm text-brand-700">
            Mastauswertung
          </Link>
          <button type="button" onClick={() => setAdding((v) => !v)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm">
            + von Hand
          </button>
          <button type="button" onClick={openImport} className="min-h-10 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white" title="Abrechnung als strukturierte Daten einfügen (Bereich livestock.schlachtungen)">
            📥 Abrechnung einfügen
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-600">
        Alle geschlachteten Tiere aus den Abrechnungen, ob Mastlamm, Milchschaf oder Rind. Alter, Geschlecht und Ablammungen kommen aus den Tierlisten (über die Ohrmarke).
      </p>

      {adding && <RecordForm onDone={() => setAdding(false)} />}
      {editingRecord && (
        <Modal title="Schlachtung bearbeiten" onClose={() => setEditingId(null)}>
          <RecordForm record={editingRecord} onDone={() => setEditingId(null)} inDialog />
        </Modal>
      )}

      {stillActive.length > 0 && <StillActiveHint list={stillActive} />}

      {data && records.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Noch keine Schlachtungen erfasst. Abrechnungen über «📥 Abrechnung einfügen» oder von Hand.</p>}

      {records.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(!year)} onClick={() => setYear('')}>
            alle Jahre
          </button>
          {years.map((y) => (
            <button key={y} type="button" className={chip(year === y)} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
          <span className="w-2" />
          <button type="button" className={chip(!cat)} onClick={() => setCat('')}>
            alle Tiere
          </button>
          {cats.map((c) => (
            <button key={c} type="button" className={chip(cat === c)} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(cat ? [cat] : cats).map((c) => {
            const s = stats(shown.filter((r) => r.category === c))
            return s.n ? (
              <div key={c} className="rounded-lg bg-white p-3 shadow-sm">
                <div className="text-xs text-gray-600">{c}</div>
                <div className="text-lg font-bold text-gray-900">{s.meanKg != null ? `Ø ${s.meanKg} kg` : '–'}</div>
                <div className="text-xs text-gray-600">
                  {s.n} Tiere{s.meanPrice != null ? ` · Ø ${fr(s.meanPrice)} Fr./kg` : ''}
                </div>
              </div>
            ) : null
          })}
        </section>
      )}

      {lambs.length > 0 && <GroupTable title="Lämmer nach Alter am Schlachttag" groups={byAge(lambs, info)} />}
      {ewes.length > 0 && <GroupTable title="Schafe nach Laktationstagen am Schlachttag" groups={byLactation(ewes, info)} />}
      {shown.length > 0 && <GroupTable title={`${cat || 'Alle Tiere'} nach Jahreszeit`} groups={bySeason(shown)} />}
      {lambs.length > 0 && <GroupTable title="Lämmer nach Geschlecht" groups={bySex(lambs, info)} />}
      {shown.length > 0 && <GroupTable title={`${cat || 'Alle Tiere'} nach Taxation`} groups={byClassification(shown)} showPrice />}

      {shown.length > 0 && (
        <section className="rounded-lg bg-white p-3 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-700">Lieferungen</h2>
          <ul className="divide-y text-sm">
            {deliveries(shown).map((d) => (
              <li key={d.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span>
                  <b>{fmtDate(d.date)}</b> {d.buyer ?? ''} {d.settlement ? <span className="text-xs text-gray-500">Nr. {d.settlement}</span> : null}
                </span>
                <span className="text-gray-700">
                  {Object.entries(d.categories)
                    .map(([c, n]) => `${n} ${c}`)
                    .join(', ')}{' '}
                  · {d.stats.meanKg != null ? `Ø ${d.stats.meanKg} kg` : ''}
                  {d.stats.amount ? ` · ${fr(d.stats.amount)} Fr.` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shown.length > 0 && (
        <section className="rounded-lg bg-white p-3 shadow-sm">
          <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="text-sm font-semibold text-brand-700">
            {showAll ? '▾' : '▸'} Einzelne Tiere ({shown.length})
          </button>
          {showAll && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-1 pr-2">Datum</th>
                    <th className="pr-2">Tier</th>
                    <th className="pr-2">Ohrmarke</th>
                    <th className="pr-2 text-right">kg</th>
                    <th className="pr-2">Tax.</th>
                    <th className="pr-2 text-right">Fr./kg</th>
                    <th className="pr-2 text-right">Alter</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((r) => (
                    <RecordRow
                      key={r.id}
                      r={r}
                      age={ageAt(r, info)}
                      lact={r.category === 'Schaf' ? lactationDaysAt(r, info) : null}
                      mastId={r.animal_key ? mastIdByKey.get(r.animal_key) : undefined}
                      onEdit={() => setEditingId(r.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function GroupTable({ title, groups, showPrice = false }: { title: string; groups: Group[]; showPrice?: boolean }) {
  const max = Math.max(...groups.map((g) => g.stats.meanKg ?? 0), 1)
  return (
    <section className="rounded-lg bg-white p-3 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">{title}</h2>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {groups.map((g) => (
            <tr key={g.key}>
              <td className="py-1 pr-2 text-gray-700">{g.label}</td>
              <td className="w-10 pr-2 text-right tabular-nums text-gray-600">{g.stats.n}</td>
              <td className="w-24 pr-2 text-right font-semibold tabular-nums">{g.stats.meanKg != null ? `Ø ${g.stats.meanKg} kg` : '–'}</td>
              <td className="hidden w-24 pr-2 text-right text-xs tabular-nums text-gray-500 sm:table-cell">{g.stats.minKg != null ? `${g.stats.minKg}–${g.stats.maxKg}` : ''}</td>
              {showPrice && <td className="w-24 pr-2 text-right tabular-nums text-gray-700">{g.stats.meanPrice != null ? `${fr(g.stats.meanPrice)} Fr.` : ''}</td>}
              <td className="w-1/4">
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-brand-600" style={{ width: `${((g.stats.meanKg ?? 0) / max) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function RecordRow({
  r,
  age,
  lact,
  mastId,
  onEdit,
}: {
  r: SlaughterRecord
  age: number | null
  lact: number | null
  mastId: string | undefined
  onEdit: () => void
}) {
  const tag = r.ear_tag ? shortEarTag(r.animal_key ?? r.ear_tag) : '–'
  return (
    <tr>
      <td className="py-1 pr-2 tabular-nums">{fmtDate(r.slaughter_date)}</td>
      <td className="pr-2">
        {r.category}
        {r.remark ? <span className="text-xs text-gray-500"> · {r.remark}</span> : null}
      </td>
      <td className="pr-2 tabular-nums">
        {mastId ? (
          <Link to={`/livestock/tiere/${mastId}`} className="inline-flex min-h-10 items-center font-medium text-brand-700">
            {tag}
          </Link>
        ) : (
          tag
        )}
      </td>
      <td className="pr-2 text-right tabular-nums">{r.carcass_kg ?? '–'}</td>
      <td className="pr-2">{r.classification ?? ''}</td>
      <td className="pr-2 text-right tabular-nums">{r.price_per_kg != null ? fr(r.price_per_kg) : ''}</td>
      <td className="pr-2 text-right text-xs tabular-nums text-gray-600">
        {age != null ? (age < 730 ? `${age} T.` : `${(age / 365).toFixed(1)} J.`) : '–'}
        {lact != null ? ` · L${lact}` : ''}
      </td>
      <td className="text-right">
        <PenButton label="Schlachtung bearbeiten" onClick={onEdit} />
      </td>
    </tr>
  )
}

/** Hinweis: laut Abrechnung geschlachtet, im Mastplaner noch «aktiv». Schreibt
 * erst nach Antippen und Bestätigen (mit Liste der Ohrmarken). */
function StillActiveHint({ list }: { list: StillActive[] }) {
  const db = useDb()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function apply() {
    setBusy(true)
    try {
      for (const a of list) {
        await markSlaughtered(db, a)
      }
      setOpen(false)
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <b>{list.length} {list.length === 1 ? 'Tier' : 'Tiere'} im Mastplaner noch aktiv</b>, obwohl in einer Abrechnung geschlachtet.
        </span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-lg border border-amber-400 bg-white px-3 font-medium">
            als geschlachtet eintragen
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <p>Diese Tiere werden auf «geschlachtet» gesetzt, ihre Gruppen-Mitgliedschaft endet am Schlachtdatum:</p>
          <ul className="list-inside list-disc">
            {list.map((a) => (
              <li key={a.animal_id}>
                {shortEarTag(a.ear_tag)} · {fmtDate(a.slaughter_date)}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void apply()} className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
              {busy ? 'Trägt ein…' : `${list.length} eintragen`}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-gray-700">
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Status «geschlachtet» und Ende der offenen Mitgliedschaft je Tier in einem Schreibvorgang. */
async function markSlaughtered(pg: PGlite, a: StillActive) {
  const open = await loadOpenMemberships(pg, a.animal_id)
  await writeBatch(async (w) => {
    await w.upsert('animals', { id: a.animal_id, status: 'geschlachtet' })
    for (const m of closeMemberships(open, a.slaughter_date)) await w.upsert('group_memberships', m)
  })
}

/** Neue Schlachtung von Hand oder eine bestehende Zeile bearbeiten (alle Felder). */
function RecordForm({ record, onDone, inDialog = false }: { record?: SlaughterRecord; onDone: () => void; inDialog?: boolean }) {
  const str = (v: number | null | undefined) => (v == null ? '' : String(v))
  const [f, setF] = useState({
    date: record?.slaughter_date ?? todayIso(),
    category: record?.category ?? 'Lamm',
    ear_tag: record?.ear_tag ?? '',
    kg: str(record?.carcass_kg),
    tax: record?.classification ?? '',
    price: str(record?.price_per_kg),
    amount: str(record?.amount),
    remark: record?.remark ?? '',
    buyer: record?.buyer ?? '',
    settlement_no: record?.settlement_no ?? '',
    weigh_slip_no: record?.weigh_slip_no ?? '',
    notes: record?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  async function save() {
    setBusy(true)
    try {
      const kg = n(f.kg)
      const price = n(f.price)
      // Betrag: was eingetragen ist; leer = Gewicht × Preis
      const amount = n(f.amount) ?? (kg != null && price != null ? Math.round(kg * price * 100) / 100 : null)
      await upsertRow('slaughter_records', {
        id: record?.id ?? crypto.randomUUID(),
        slaughter_date: f.date,
        ear_tag: f.ear_tag.trim() || null,
        animal_key: animalKey(f.ear_tag.trim()) ?? null,
        category: f.category,
        carcass_kg: kg,
        classification: f.tax.trim().toUpperCase() || null,
        price_per_kg: price,
        amount,
        remark: f.remark.trim() || null,
        buyer: f.buyer.trim() || null,
        settlement_no: f.settlement_no.trim() || null,
        weigh_slip_no: f.weigh_slip_no.trim() || null,
        source: record ? record.source : 'manuell',
        notes: f.notes.trim() || null,
        deleted_at: null,
      } as never)
      onDone()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!record || !window.confirm('Diese Schlachtung löschen?')) return
    try {
      await softDeleteRow('slaughter_records', record.id)
      onDone()
    } catch (e) {
      notifyError(errorText(e))
    }
  }
  const input = 'w-full min-h-11 rounded-lg border border-gray-300 px-2 text-sm'
  return (
    <section className={`grid grid-cols-2 gap-2 ${inDialog ? '' : 'rounded-lg bg-white p-3 shadow-sm sm:grid-cols-4'}`}>
      {record && !inDialog && <h3 className="col-span-2 text-sm font-semibold text-gray-700 sm:col-span-4">Schlachtung bearbeiten</h3>}
      <label className="text-xs text-gray-600">
        Datum
        <input type="date" value={f.date} onChange={set('date')} className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Tier
        <select value={f.category} onChange={set('category')} className={input}>
          {(CATEGORIES as readonly string[]).includes(f.category) ? null : <option>{f.category}</option>}
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-gray-600">
        Ohrmarke
        <input value={f.ear_tag} onChange={set('ear_tag')} inputMode="numeric" className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Schlachtgewicht kg
        <input value={f.kg} onChange={set('kg')} inputMode="decimal" className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Taxation
        <input value={f.tax} onChange={set('tax')} placeholder="T2" className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Fr./kg
        <input value={f.price} onChange={set('price')} inputMode="decimal" className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Betrag Fr. (leer = kg × Preis)
        <input value={f.amount} onChange={set('amount')} inputMode="decimal" className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Vermerk
        <input value={f.remark} onChange={set('remark')} placeholder="klein, nass" className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Abnehmer
        <input value={f.buyer} onChange={set('buyer')} className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Abrechnungs-Nr.
        <input value={f.settlement_no} onChange={set('settlement_no')} className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Waagschein-Nr.
        <input value={f.weigh_slip_no} onChange={set('weigh_slip_no')} className={input} />
      </label>
      <label className="text-xs text-gray-600">
        Notiz
        <input value={f.notes} onChange={set('notes')} className={input} />
      </label>
      <div className={`col-span-2 flex flex-wrap gap-2 ${inDialog ? '' : 'sm:col-span-4'}`}>
        <button type="button" disabled={busy || !f.date} onClick={() => void save()} className="min-h-11 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
          Speichern
        </button>
        <button type="button" onClick={onDone} className="min-h-11 px-3 text-gray-700">
          Abbrechen
        </button>
        {record && (
          <button type="button" onClick={() => void remove()} className="ml-auto min-h-11 rounded-lg border border-red-300 px-3 text-red-700">
            Löschen
          </button>
        )}
      </div>
    </section>
  )
}
