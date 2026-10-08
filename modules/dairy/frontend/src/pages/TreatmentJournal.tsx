import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { read, utils } from 'xlsx'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import TreatmentItems, { emptyItem } from '../components/TreatmentItems'
import { addDays, fmtDate, isoDate, localTodayIso } from '../lib/format'
import { deleteTemplate, importTreatments, loadTreatmentContext, saveTemplate, type TreatmentContext } from '../lib/treatmentData'
import { parseCownect, parseItems, suggestTemplates, withdrawalUntil, type TemplateSuggestion } from '../lib/treatments'
import type { AnimalJournalEntry, TemplateItem, TreatmentTemplate } from '../types'

type Row = AnimalJournalEntry & { a_name: string | null; a_lauf_nr: string | null; a_ear_tag: string | null }
interface Case {
  key: string
  rows: Row[]
  animalId: string | null
  label: string
  earTag: string
  date: string
  time: string | null
}

const n = (v: unknown) => (v == null ? null : Number(v))
const release = (r: Row, kind: 'milk' | 'meat') => {
  const until = withdrawalUntil(r, kind)
  return until ? addDays(until, 1) : null
}
const fristText = (r: Row) => {
  const f = r.withdrawal_factor && r.withdrawal_factor > 1 ? `${r.withdrawal_factor}× ` : ''
  return r.withdrawal_milk_days == null && r.withdrawal_meat_days == null ? '' : `${f}${r.withdrawal_milk_days ?? '–'} / ${r.withdrawal_meat_days ?? '–'} T.`
}

async function loadJournal(db: Parameters<typeof loadTreatmentContext>[0]) {
  const [{ rows }, ctx] = await Promise.all([
    db.query<Row>(
      `select j.*, a.name as a_name, a.lauf_nr as a_lauf_nr, a.ear_tag as a_ear_tag
       from animal_journal j left join animals a on a.id = j.animal_id
       where j.deleted_at is null and (j.category = 'behandlung' or j.source = 'import')
       order by j.entry_date desc, j.treatment_time desc nulls last`,
    ),
    loadTreatmentContext(db),
  ])
  const journal = rows.map((r) => ({
    ...r,
    entry_date: isoDate(r.entry_date)!,
    last_date: isoDate(r.last_date),
    release_milk_date: isoDate(r.release_milk_date),
    release_meat_date: isoDate(r.release_meat_date),
    withdrawal_milk_days: n(r.withdrawal_milk_days),
    withdrawal_meat_days: n(r.withdrawal_meat_days),
    withdrawal_factor: n(r.withdrawal_factor),
    applications: n(r.applications),
  }))
  return { journal, ctx }
}

function toCases(rows: Row[]): Case[] {
  const map = new Map<string, Case>()
  for (const r of rows) {
    const key = r.case_id ?? r.id
    let c = map.get(key)
    if (!c) {
      const tag = r.a_ear_tag ?? r.ear_tag ?? ''
      const name = r.a_name ?? r.animal_name
      c = { key, rows: [], animalId: r.animal_id, label: [r.a_lauf_nr, name].filter(Boolean).join(' ') || shortEarTag(tag), earTag: tag, date: r.entry_date, time: r.treatment_time }
      map.set(key, c)
    }
    c.rows.push(r)
  }
  return [...map.values()]
}

const CSV_HEADER = [
  'Datum 1. Anwendung', 'Uhrzeit', 'Letzte Anwendung', 'Tier', 'Ohrmarke', 'Indikation / Befund', 'Organ / Position', 'Präparat (Handelsname)', 'Menge',
  'Anzahl Anwendungen', 'Absetzfrist Milch (Tage)', 'Absetzfrist Fleisch (Tage)', 'Faktor', 'Freigabe Milch', 'Freigabe Fleisch', 'Behandelt durch',
  'Abgabestelle', 'Bemerkung',
]
function csvLine(c: Case, r: Row): string[] {
  return [
    fmtDate(r.entry_date), r.treatment_time ?? '', fmtDate(r.last_date ?? r.entry_date), c.label, c.earTag, r.diagnosis ?? '', r.body_system ?? '',
    r.medication ?? '', r.dose ?? '', String(r.applications ?? ''), String(r.withdrawal_milk_days ?? ''), String(r.withdrawal_meat_days ?? ''),
    String(r.withdrawal_factor ?? 1), fmtDate(release(r, 'milk')), fmtDate(release(r, 'meat')), r.administered_by ?? '', r.supplier ?? '',
    r.text !== [r.diagnosis, [r.medication, r.dose].filter(Boolean).join(' ')].filter(Boolean).join(' – ') ? r.text : '',
  ]
}

const PRINT_CSS = `
#bj-print { display: none; }
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html, body { background: #fff !important; }
  body > *:not(#bj-print) { display: none !important; }
  #bj-print { display: block; font-family: Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #000; }
  #bj-print h1 { font-size: 13pt; margin: 0 0 1mm; }
  #bj-print table { width: 100%; border-collapse: collapse; }
  #bj-print th { text-align: left; font-weight: bold; border-bottom: 0.4mm solid #000; padding: 0.8mm; vertical-align: bottom; }
  #bj-print td { border-bottom: 0.2mm solid #999; padding: 0.8mm; vertical-align: top; }
  #bj-print tr { break-inside: avoid; }
}`

function PrintTable({ cases, period }: { cases: Case[]; period: string }) {
  return createPortal(
    <div id="bj-print">
      <h1>Behandlungsjournal Tierarzneimittel</h1>
      <div style={{ marginBottom: '2mm' }}>
        {period} · gedruckt {fmtDate(localTodayIso())} · Absetzfrist ab letzter Anwendung; Freigabe = erster Tag, an dem Milch bzw. Fleisch wieder abgeliefert werden darf
      </div>
      <table>
        <thead>
          <tr>
            {['1. Anw.', 'letzte', 'Tier', 'Ohrmarke', 'Indikation', 'Präparat', 'Menge', 'Anw.', 'Frist M/F', 'Freigabe Milch', 'Freigabe Fleisch', 'behandelt durch', 'Abgabestelle'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cases.flatMap((c) =>
            c.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {fmtDate(r.entry_date)}
                  {r.treatment_time ? ` ${r.treatment_time}` : ''}
                </td>
                <td>{r.last_date ? fmtDate(r.last_date) : ''}</td>
                <td>{c.label}</td>
                <td>{shortEarTag(c.earTag)}</td>
                <td>{[r.diagnosis, r.body_system].filter(Boolean).join('; ')}</td>
                <td>{r.medication}</td>
                <td>{r.dose}</td>
                <td>{r.applications ?? ''}</td>
                <td>{fristText(r)}</td>
                <td>{fmtDate(release(r, 'milk'))}</td>
                <td>{fmtDate(release(r, 'meat'))}</td>
                <td>{r.administered_by}</td>
                <td>{r.supplier}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>,
    document.body,
  )
}

/** Favorit bearbeiten/anlegen. */
function TemplateEditor({ template, ctx, onDone }: { template: Partial<TreatmentTemplate> & { title: string }; ctx: TreatmentContext; onDone: () => void }) {
  const db = useDb()
  const [t, setT] = useState(template)
  const [items, setItems] = useState<TemplateItem[]>(() => {
    const its = parseItems(template.items)
    return its.length ? its : [emptyItem()]
  })
  const [busy, setBusy] = useState(false)
  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
  async function save() {
    setBusy(true)
    try {
      await saveTemplate(db, {
        id: t.id ?? crypto.randomUUID(),
        title: t.title.trim(),
        body_system: t.body_system?.trim() || null,
        diagnosis: t.diagnosis?.trim() || null,
        items: JSON.stringify(items.filter((i) => i.medication.trim() || i.hint)),
        supplier: t.supplier?.trim() || null,
        notes: t.notes?.trim() || null,
        sort_order: t.sort_order ?? ctx.templates.length * 10 + 10,
      })
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-white p-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-gray-600">
          Name
          <input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} className={input} />
        </label>
        <label className="block text-gray-600">
          Abgabestelle
          <input value={t.supplier ?? ''} onChange={(e) => setT({ ...t, supplier: e.target.value })} className={input} />
        </label>
        <label className="block text-gray-600">
          Indikation / Befund
          <input value={t.diagnosis ?? ''} onChange={(e) => setT({ ...t, diagnosis: e.target.value })} className={input} />
        </label>
        <label className="block text-gray-600">
          Organ / Position
          <input value={t.body_system ?? ''} onChange={(e) => setT({ ...t, body_system: e.target.value })} className={input} />
        </label>
      </div>
      <TreatmentItems items={items} onChange={setItems} known={ctx.medications} factor={ctx.usualFactor} compact />
      <label className="block text-gray-600">
        Hinweis
        <input value={t.notes ?? ''} onChange={(e) => setT({ ...t, notes: e.target.value })} className={input} />
      </label>
      <div className="flex gap-2">
        {t.id && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm(`Favorit «${t.title}» löschen? Erfasste Behandlungen bleiben.`)) void deleteTemplate(db, t.id!).then(onDone)
            }}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-red-700"
          >
            Löschen
          </button>
        )}
        <button type="button" onClick={onDone} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700">
          Abbrechen
        </button>
        <button type="button" disabled={busy || !t.title.trim()} onClick={() => void save()} className="flex-1 rounded-lg bg-brand-700 py-1.5 font-semibold text-white disabled:opacity-50">
          Favorit speichern
        </button>
      </div>
    </div>
  )
}

/** Behandlungsjournal (Tierarzneimittel) nach den Mindestanforderungen der
 * amtlichen Kontrolle: alle Behandlungen, offene Absetzfristen, Druck und
 * CSV, Import aus cownect, Favoriten. */
export default function TreatmentJournal({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const { data } = useQuery(loadJournal)
  const today = localTodayIso()
  const [period, setPeriod] = useState('12m')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<(Partial<TreatmentTemplate> & { title: string }) | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCase, setConfirmCase] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cases = useMemo(() => toCases(data?.journal ?? []), [data])
  const years = [...new Set(cases.map((c) => c.date.slice(0, 4)))].sort().reverse()
  const from = period === '12m' ? addDays(today, -365) : period === 'alle' ? '0000' : `${period}-01-01`
  const to = period === '12m' || period === 'alle' ? '9999' : `${period}-12-31`
  const shown = cases.filter((c) => {
    if (c.date < from || c.date > to) return false
    const s = q.trim().toLowerCase()
    return !s || [c.label, c.earTag, ...c.rows.flatMap((r) => [r.diagnosis, r.medication, r.body_system])].some((v) => (v ?? '').toLowerCase().includes(s))
  })
  const periodLabel = period === '12m' ? `${fmtDate(from)} – ${fmtDate(today)}` : period === 'alle' ? 'alle Behandlungen' : `Jahr ${period}`

  // offene Absetzfristen je Tier
  const open = new Map<string, { label: string; animalId: string | null; milk: string | null; meat: string | null }>()
  for (const c of cases)
    for (const r of c.rows) {
      const milk = withdrawalUntil(r, 'milk')
      const meat = withdrawalUntil(r, 'meat')
      if ((!milk || milk < today) && (!meat || meat < today)) continue
      const k = c.animalId ?? c.earTag
      const o = open.get(k) ?? { label: c.label, animalId: c.animalId, milk: null, meat: null }
      if (milk && milk >= today && (!o.milk || milk > o.milk)) o.milk = milk
      if (meat && meat >= today && (!o.meat || meat > o.meat)) o.meat = meat
      open.set(k, o)
    }

  const suggestions: TemplateSuggestion[] = useMemo(() => {
    if (!data) return []
    const have = new Set(data.ctx.templates.map((t) => t.title.toLowerCase()))
    return suggestTemplates(data.journal).filter((s) => !have.has(s.title.toLowerCase()))
  }, [data])

  async function onImport(file: File) {
    setBusy(true)
    setImportMsg(null)
    try {
      const wb = read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const rows = utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true })
      const { items, skipped } = parseCownect(rows)
      const r = await importTreatments(db, items)
      setImportMsg(
        `${r.added} Behandlungen neu importiert (${r.matched} Herdentieren zugeordnet, übrige mit Ohrmarke und Name), ${r.existing} waren schon da${skipped ? `, ${skipped} Zeilen ohne Tier/Datum übersprungen` : ''}.`,
      )
    } catch (e) {
      setImportMsg(`Import fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function exportCsv() {
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const lines = shown.flatMap((c) => c.rows.map((r) => csvLine(c, r).map(esc).join(';')))
    const blob = new Blob(['﻿' + [CSV_HEADER.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `behandlungsjournal-${moduleKey}-${today}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function deleteCase(c: Case) {
    await inTransaction(db, async (tx) => {
      for (const r of c.rows) await softDeleteRow(tx, 'animal_journal', r.id)
    })
    setConfirmCase(null)
  }

  const btn = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm'
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <style>{PRINT_CSS}</style>
      <PrintTable cases={shown} period={periodLabel} />
      <div>
        <Link to="../erfassen" relative="path" className="text-sm text-brand-700">
          ← Erfassen
        </Link>
        <h1 className="text-xl font-bold text-gray-800">Behandlungsjournal</h1>
        <p className="text-xs text-gray-500">
          Tierarzneimittel nach den Mindestanforderungen der amtlichen Kontrolle: Datum erste/letzte Anwendung, Tier, Indikation, Handelsname, Menge,
          Absetzfristen mit Freigabedatum, behandelnde Person, Abgabestelle.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="../journal" relative="path" className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm">
          ＋ Behandlung erfassen
        </Link>
        <button type="button" className={btn} onClick={() => window.print()}>
          Drucken
        </button>
        <button type="button" className={btn} onClick={exportCsv}>
          CSV
        </button>
        <button type="button" className={btn} disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Importiere…' : 'cownect-Liste importieren'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && void onImport(e.target.files[0])} />
      </div>
      {importMsg && <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{importMsg}</p>}

      {open.size > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <h2 className="mb-1 font-semibold text-red-800">Laufende Absetzfristen</h2>
          <ul className="space-y-0.5">
            {[...open.values()].map((o) => (
              <li key={o.label} className="text-red-900">
                {o.animalId ? (
                  <Link to={`../kuehe/${o.animalId}`} relative="path" className="font-medium underline">
                    {o.label}
                  </Link>
                ) : (
                  <b>{o.label}</b>
                )}
                {o.milk ? ` · Milch nicht abliefern bis und mit ${fmtDate(o.milk)}` : ''}
                {o.meat ? ` · Fleisch gesperrt bis und mit ${fmtDate(o.meat)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm">
          <option value="12m">letzte 12 Monate</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
          <option value="alle">alle</option>
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tier, Befund, Präparat" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <span className="text-xs text-gray-500">{shown.length} Fälle</span>
      </div>

      <ul className="space-y-2">
        {shown.map((c) => {
          const first = c.rows[0]
          return (
            <li key={c.key} className="rounded-lg bg-white p-3 text-sm shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">
                    {fmtDate(c.date)}
                    {c.time ? ` ${c.time}` : ''} ·{' '}
                    {c.animalId ? (
                      <Link to={`../kuehe/${c.animalId}`} relative="path" className="font-semibold text-brand-700">
                        {c.label}
                      </Link>
                    ) : (
                      <b className="text-gray-700">{c.label}</b>
                    )}{' '}
                    {shortEarTag(c.earTag)}
                    {first.source === 'import' ? ' · cownect' : ''}
                  </div>
                  <div className="font-medium text-gray-800">{first.diagnosis ?? first.text}</div>
                  {first.body_system && <div className="text-xs text-gray-500">{first.body_system}</div>}
                </div>
                {first.source === 'manual' &&
                  (confirmCase === c.key ? (
                    <button type="button" onClick={() => void deleteCase(c)} className="shrink-0 rounded bg-red-600 px-2 py-1 text-xs text-white">
                      Wirklich löschen?
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmCase(c.key)} className="shrink-0 px-1 text-gray-400" aria-label="Behandlung löschen">
                      ×
                    </button>
                  ))}
              </div>
              <ul className="mt-1 space-y-1">
                {c.rows
                  .filter((r) => r.medication)
                  .map((r) => {
                    const milk = release(r, 'milk')
                    const meat = release(r, 'meat')
                    return (
                      <li key={r.id} className="border-l-2 border-brand-200 pl-2">
                        <div className="text-gray-800">
                          {r.medication}
                          {r.critical_antibiotic && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-800">kritisches Antibiotikum</span>}
                        </div>
                        <div className="text-xs text-gray-600">
                          {[
                            r.dose,
                            r.applications ? `${r.applications}× angewendet` : null,
                            r.last_date ? `bis ${fmtDate(r.last_date)}` : null,
                            fristText(r) ? `Frist ${fristText(r)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                        {(milk || meat) && (
                          <div className={`text-xs ${(milk && milk > today) || (meat && meat > today) ? 'font-medium text-red-700' : 'text-gray-500'}`}>
                            Freigabe {milk ? `Milch ${fmtDate(milk)}` : ''}
                            {milk && meat ? ', ' : ''}
                            {meat ? `Fleisch ${fmtDate(meat)}` : ''}
                          </div>
                        )}
                      </li>
                    )
                  })}
              </ul>
              <div className="mt-1 text-xs text-gray-500">
                {[first.administered_by && `behandelt durch ${first.administered_by}`, first.supplier && `Abgabe ${first.supplier}`].filter(Boolean).join(' · ')}
                {first.text && first.text !== first.diagnosis && !first.text.startsWith(first.diagnosis ?? '\u0000') ? ` · ${first.text}` : ''}
              </div>
            </li>
          )
        })}
        {data && shown.length === 0 && <p className="text-center text-sm text-gray-500">Keine Behandlungen im gewählten Zeitraum.</p>}
      </ul>

      {data && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Favoriten</h2>
            <button type="button" className={btn} onClick={() => setEditing({ title: '' })}>
              ＋ Favorit
            </button>
          </div>
          {editing && <TemplateEditor key={editing.id ?? 'new'} template={editing} ctx={data.ctx} onDone={() => setEditing(null)} />}
          {data.ctx.templates.length === 0 && !editing && <p className="text-sm text-gray-500">Noch keine Favoriten — Vorschläge unten übernehmen.</p>}
          <ul className="divide-y rounded-lg bg-white shadow-sm">
            {data.ctx.templates.map((t) => {
              const its = parseItems(t.items)
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setEditing(t)} className="w-full px-3 py-2 text-left text-sm">
                    <span className="font-medium text-gray-800">★ {t.title}</span>
                    <span className="block text-xs text-gray-500">
                      {its.map((i) => (i.medication ? `${i.medication.split(/\s+ad\.?\s*us\.|,/)[0]} ${i.dose}`.trim() : `⚠ ${i.hint ?? 'Präparat fehlt'}`)).join(' + ')}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {suggestions.length > 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-sm">
              <h3 className="mb-1 font-medium text-gray-700">Vorschläge aus dem Journal (typische Behandlungen)</h3>
              <ul className="divide-y">
                {suggestions.map((s) => (
                  <li key={s.key} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="text-gray-800">{s.title}</span> <span className="text-xs text-gray-500">{s.count}× · zuletzt {fmtDate(s.lastDate)}</span>
                      <span className="block truncate text-xs text-gray-500">
                        {s.items.map((i) => (i.medication ? i.medication.split(/\s+ad\.?\s*us\.|,/)[0] : '⚠ Schmerzmittel (NSAID) fehlt')).join(' + ')}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={btn}
                      onClick={() =>
                        setEditing({ title: s.title, diagnosis: s.diagnosis, body_system: s.body_system, supplier: s.supplier, items: JSON.stringify(s.items), notes: null })
                      }
                    >
                      übernehmen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
