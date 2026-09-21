import { useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { syncClient } from '../db/sync'
import { fmtArea, PARCEL_CATEGORY_COLOR, PARCEL_CATEGORY_LABEL, PARCEL_SOURCE_LABEL } from '../lib/format'
import { importParcelsFromFields, type ParcelsImportResult } from '../lib/parcelsImport'
import { mergeParcel } from '../lib/parcels'
import { categoryFilterSql, useShowAcker } from '../hooks/useShowAcker'
import AckerToggle from '../components/AckerToggle'
import Modal from '../components/Modal'
import type { Intensitaet, Parcel, ParcelCategory } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

async function loadParcels(pg: PGlite, seasonYear: number, showAcker: boolean): Promise<Parcel[]> {
  const { rows } = await pg.query<Parcel>(
    `select * from parcels where season_year = $1 and deleted_at is null${categoryFilterSql(showAcker)}
     order by farm_name nulls last, category, sort_order, name`,
    [seasonYear],
  )
  return rows
}

const INTENSITAET_OPTIONS: { value: Intensitaet; label: string }[] = [
  { value: 'i', label: 'i — intensiv' },
  { value: 'wi', label: 'wi — wenig intensiv' },
  { value: 'mi', label: 'mi — mittel-intensiv' },
  { value: 'e', label: 'e — extensiv' },
]

interface FormState {
  existing: Parcel | null
  name: string
  area_a: string
  wiesentyp: string
  intensitaet: Intensitaet | ''
  category: ParcelCategory
  notes: string
}

const EMPTY_FORM: FormState = {
  existing: null,
  name: '',
  area_a: '',
  wiesentyp: '',
  intensitaet: '',
  category: 'futter',
  notes: '',
}

export default function Parcels() {
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR)
  const [showAcker] = useShowAcker()
  const { data, loading, refresh } = useQuery((pg) => loadParcels(pg, seasonYear, showAcker), [seasonYear, showAcker])
  const canWrite = useHasPermission('wiesenjournal:parcels:write')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ParcelsImportResult | string | null>(null)
  const [mergeSource, setMergeSource] = useState<Parcel | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')

  const parcels = data ?? []
  const gelanParcels = parcels.filter((p) => p.source === 'fields')

  function openNew() {
    setForm({ ...EMPTY_FORM })
  }

  function openEdit(p: Parcel) {
    setForm({
      existing: p,
      name: p.name,
      area_a: p.area_a == null ? '' : String(p.area_a),
      wiesentyp: p.wiesentyp ?? '',
      intensitaet: p.intensitaet ?? '',
      category: p.category ?? 'futter',
      notes: p.notes ?? '',
    })
  }

  async function save() {
    if (!form || !form.name.trim()) return
    setSaving(true)
    try {
      // Bestehende Zeile als Basis, damit die GELAN-Snapshot-Spalten
      // (Geometrie, Betrieb, Kultur, lineage) beim Bearbeiten erhalten bleiben.
      const base: Partial<Parcel> = form.existing ?? {
        id: crypto.randomUUID(),
        season_year: seasonYear,
        base_geometry: null,
        sort_order: parcels.length,
        source: 'manual',
        farm_id: null,
        farm_name: null,
        fields_lineage_id: null,
        fields_declaration_id: null,
        external_kultur_id: null,
        kultur_code: null,
        kultur_name_de: null,
      }
      const isGelan = form.existing?.source === 'fields'
      await upsertRow('parcels', {
        ...base,
        name: isGelan ? form.existing!.name : form.name.trim(),
        area_a: isGelan ? form.existing!.area_a : form.area_a ? Number(form.area_a) : null,
        category: isGelan ? form.existing!.category : form.category,
        wiesentyp: form.wiesentyp.trim() || null,
        intensitaet: form.intensitaet || null,
        notes: form.notes.trim() || null,
      } as never)
      setForm(null)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: Parcel) {
    if (!confirm(`Parzelle "${p.name}" wirklich löschen?`)) return
    await softDeleteRow('parcels', p.id)
    refresh()
  }

  async function runImport() {
    setImporting(true)
    setImportResult(null)
    try {
      const result = await importParcelsFromFields(seasonYear)
      setImportResult(result)
      await syncClient.syncNow()
      refresh()
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Übernahme fehlgeschlagen')
    } finally {
      setImporting(false)
    }
  }

  async function runMerge() {
    const target = parcels.find((p) => p.id === mergeTargetId)
    if (!mergeSource || !target) return
    setSaving(true)
    try {
      await mergeParcel(mergeSource, target)
      setMergeSource(null)
      setMergeTargetId('')
      refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Parzellen {seasonYear}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AckerToggle />
          <select
            value={seasonYear}
            onChange={(e) => setSeasonYear(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {canWrite && (
            <>
              <button
                type="button"
                onClick={runImport}
                disabled={importing}
                title="Journal-Parzellen aus den GELAN-Deklarationen des Kulturen-Moduls übernehmen (braucht Internet)"
                className="rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-700 active:bg-brand-50 disabled:opacity-50"
              >
                {importing ? 'Übernehme…' : `Aus GELAN übernehmen (${seasonYear})`}
              </button>
              <button
                type="button"
                onClick={openNew}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-700"
              >
                + Parzelle
              </button>
            </>
          )}
        </div>
      </div>

      {importResult && (
        <div
          className={`rounded-lg p-3 text-sm ${
            typeof importResult === 'string' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-900'
          }`}
        >
          {typeof importResult === 'string' ? (
            importResult
          ) : (
            <>
              GELAN {importResult.year}: {importResult.inserted} neu, {importResult.updated} aktualisiert,{' '}
              {importResult.unchanged} unverändert, {importResult.deleted} entfernt.
              {importResult.orphaned.length > 0 && (
                <div className="mt-1 text-xs text-amber-700">
                  Nicht mehr in GELAN, aber mit Einträgen (bleiben): {importResult.orphaned.join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && parcels.length === 0 && (
        <p className="text-center text-gray-500">
          Noch keine Parzellen für {seasonYear} — „Aus GELAN übernehmen" (Kulturen-Modul muss die Raumdaten des
          Jahres haben) oder manuell anlegen.
        </p>
      )}

      <ul className="space-y-2">
        {parcels.map((p) => (
          <li key={p.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-semibold text-gray-800">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: PARCEL_CATEGORY_COLOR[p.category] ?? '#6b7280' }}
                    title={PARCEL_CATEGORY_LABEL[p.category] ?? p.category}
                  />
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                    {PARCEL_SOURCE_LABEL[p.source] ?? p.source}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {fmtArea(p.area_a)}
                  {p.farm_name ? ` · ${p.farm_name}` : ''}
                  {p.kultur_name_de ? ` · ${p.kultur_name_de}` : ''}
                  {p.wiesentyp ? ` · ${p.wiesentyp}` : ''}
                  {p.intensitaet ? ` · ${p.intensitaet}` : ''}
                </div>
                {p.notes && <div className="mt-1 text-xs text-gray-400">{p.notes}</div>}
              </div>
              {canWrite && (
                <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded px-2 py-1 text-xs text-brand-700 active:bg-brand-50"
                  >
                    Bearbeiten
                  </button>
                  {p.source !== 'fields' && gelanParcels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMergeSource(p)
                        setMergeTargetId('')
                      }}
                      className="rounded px-2 py-1 text-xs text-brand-700 active:bg-brand-50"
                      title="Einträge dieser Parzelle einer GELAN-Parzelle zuordnen"
                    >
                      GELAN zuordnen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    className="rounded px-2 py-1 text-xs text-red-600 active:bg-red-50"
                  >
                    Löschen
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {form && (
        <Modal title={form.existing ? 'Parzelle bearbeiten' : 'Neue Parzelle'} onClose={() => setForm(null)}>
          <div className="space-y-3">
            {form.existing?.source === 'fields' && (
              <p className="rounded bg-gray-50 p-2 text-xs text-gray-500">
                GELAN-Parzelle — Name, Fläche, Kultur und Geometrie kommen aus dem Kulturen-Modul und werden bei der
                nächsten Übernahme nachgeführt.
              </p>
            )}
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Name / Schlag</span>
              <input
                type="text"
                value={form.name}
                disabled={form.existing?.source === 'fields'}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                autoFocus={!form.existing}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Aren</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.area_a}
                  disabled={form.existing?.source === 'fields'}
                  onChange={(e) => setForm({ ...form, area_a: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Kategorie</span>
                <select
                  value={form.category}
                  disabled={form.existing?.source === 'fields'}
                  onChange={(e) => setForm({ ...form, category: e.target.value as ParcelCategory })}
                  className="w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                >
                  {Object.entries(PARCEL_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Wiesentyp / Leitgras-Mischung</span>
              <input
                type="text"
                value={form.wiesentyp}
                onChange={(e) => setForm({ ...form, wiesentyp: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Intensität</span>
              <select
                value={form.intensitaet}
                onChange={(e) => setForm({ ...form, intensitaet: e.target.value as Intensitaet })}
                className="w-full rounded border border-gray-300 px-3 py-2"
              >
                <option value="">–</option>
                {INTENSITAET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2"
                rows={2}
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !form.name.trim()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </Modal>
      )}

      {mergeSource && (
        <Modal title={`„${mergeSource.name}" einer GELAN-Parzelle zuordnen`} onClose={() => setMergeSource(null)}>
          <p className="mb-3 text-sm text-gray-600">
            Alle Einträge (Nutzung, Düngung, Gaben, Weidegänge, Unkraut) wandern zur gewählten GELAN-Parzelle;
            „{mergeSource.name}" wird danach gelöscht. Wiesentyp/Intensität/Bemerkung werden übernommen, falls
            dort leer.
          </p>
          <select
            value={mergeTargetId}
            onChange={(e) => setMergeTargetId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">GELAN-Parzelle wählen…</option>
            {gelanParcels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.farm_name ? `${p.farm_name} · ` : ''}
                {p.name} · {p.kultur_name_de ?? ''} · {fmtArea(p.area_a)}
              </option>
            ))}
          </select>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setMergeSource(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={runMerge}
              disabled={saving || !mergeTargetId}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Zuordnen
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
