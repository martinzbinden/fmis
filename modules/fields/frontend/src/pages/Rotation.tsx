import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { fmtArea, num } from '../lib/format'
import type { FieldDeclaration, FieldLineageSummary } from '../types'

const SOURCE_LABEL: Record<FieldDeclaration['source'], string> = {
  import: 'Import',
  plan: 'Geplant',
}

async function loadLineages(pg: PGlite): Promise<FieldLineageSummary[]> {
  const { rows } = await pg.query<FieldLineageSummary>(
    `select * from v_field_lineage_summary order by flurname nulls last, kultur_name_de`,
  )
  return rows
}

async function loadDeclarations(pg: PGlite): Promise<FieldDeclaration[]> {
  const { rows } = await pg.query<FieldDeclaration>(
    `select * from field_declarations where deleted_at is null order by jahr desc, sequence_in_year`,
  )
  return rows.map((r) => ({ ...r, area_a: num(r.area_a) }))
}

interface CropOption {
  code: string
  name: string
}

export default function Rotation() {
  const { data: lineages } = useQuery(loadLineages)
  const { data: declarations, refresh } = useQuery(loadDeclarations)
  const [expanded, setExpanded] = useState<string | null>(null)

  const byLineage = useMemo(() => {
    const map = new Map<string, FieldDeclaration[]>()
    for (const d of declarations ?? []) {
      const list = map.get(d.lineage_id) ?? []
      list.push(d)
      map.set(d.lineage_id, list)
    }
    return map
  }, [declarations])

  // Kultur-Auswahl wächst organisch mit jedem Import — kein separates
  // Katalog-Schema nötig (siehe Plan).
  const cropOptions = useMemo<CropOption[]>(() => {
    const map = new Map<string, string>()
    for (const d of declarations ?? []) {
      if (!map.has(d.kultur_code)) map.set(d.kultur_code, d.kultur_name_de ?? d.kultur_code)
    }
    return [...map.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [declarations])

  if (lineages && lineages.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        Noch keine Parzellen — zuerst unter "Karte" Raumdaten importieren.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Fruchtfolge</h1>

      <ul className="space-y-2">
        {(lineages ?? []).map((lineage) => {
          const rows = byLineage.get(lineage.lineage_id) ?? []
          const isOpen = expanded === lineage.lineage_id
          return (
            <li key={lineage.lineage_id} className="rounded-lg bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : lineage.lineage_id)}
                className="flex w-full items-center justify-between gap-2 p-3 text-left"
              >
                <div>
                  <div className="font-semibold text-gray-800">
                    {lineage.flurname ?? lineage.kultur_name_de ?? lineage.kultur_code}
                  </div>
                  <div className="text-xs text-gray-500">
                    {lineage.kultur_name_de ?? lineage.kultur_code} · zuletzt {lineage.latest_jahr}
                  </div>
                </div>
                <span className="text-gray-400">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="border-t p-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="py-1 pr-2 font-medium">Jahr</th>
                        <th className="py-1 pr-2 font-medium">Kultur</th>
                        <th className="py-1 pr-2 font-medium">Fläche</th>
                        <th className="py-1 font-medium">Quelle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="py-1 pr-2 text-gray-600">
                            {r.jahr}
                            {r.sequence_in_year > 1 ? ` (${r.sequence_in_year}.)` : ''}
                          </td>
                          <td className="py-1 pr-2 text-gray-800">{r.kultur_name_de ?? r.kultur_code}</td>
                          <td className="py-1 pr-2 text-gray-600">{fmtArea(r.area_a)}</td>
                          <td className="py-1 text-gray-500">{SOURCE_LABEL[r.source]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <PlanForm
                    lineage={lineage}
                    latestDeclaration={rows[0]}
                    existingYears={rows.map((r) => r.jahr)}
                    cropOptions={cropOptions}
                    onPlanned={refresh}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PlanForm({
  lineage,
  latestDeclaration,
  existingYears,
  cropOptions,
  onPlanned,
}: {
  lineage: FieldLineageSummary
  latestDeclaration: FieldDeclaration | undefined
  existingYears: number[]
  cropOptions: CropOption[]
  onPlanned: () => void
}) {
  const suggestedYear = (existingYears.length > 0 ? Math.max(...existingYears) : new Date().getFullYear()) + 1
  const [show, setShow] = useState(false)
  const [year, setYear] = useState(String(suggestedYear))
  const [kulturCode, setKulturCode] = useState('')
  const [customName, setCustomName] = useState('')
  const [zwischenfutter, setZwischenfutter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const yearNum = Number(year)
    if (!Number.isInteger(yearNum)) {
      setError('Bitte ein gültiges Jahr angeben.')
      return
    }
    const isCustom = kulturCode === '__custom__'
    const name = isCustom ? customName.trim() : cropOptions.find((o) => o.code === kulturCode)?.name
    const code = isCustom ? customName.trim() : kulturCode
    if (!code) {
      setError('Bitte eine Kultur wählen oder eingeben.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const sameYear = existingYears.filter((y) => y === yearNum).length
      await upsertRow('field_declarations', {
        id: crypto.randomUUID(),
        farm_id: lineage.farm_id,
        lineage_id: lineage.lineage_id,
        management_unit_external_id: latestDeclaration?.management_unit_external_id ?? null,
        external_kultur_id: null,
        jahr: yearNum,
        sequence_in_year: zwischenfutter ? sameYear + 1 : 1,
        kultur_code: code,
        kultur_name_de: name ?? code,
        kultur_name_fr: null,
        flurname: latestDeclaration?.flurname ?? lineage.flurname ?? null,
        area_a: latestDeclaration?.area_a ?? null,
        baeume: null,
        geometry: latestDeclaration?.geometry ?? null,
        source: 'plan',
      })
      setShow(false)
      setKulturCode('')
      setCustomName('')
      setZwischenfutter(false)
      onPlanned()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="mt-3 rounded-lg border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700"
      >
        + Für ein Jahr planen
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="flex gap-2">
        <label className="flex-1 text-sm">
          Jahr
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <label className="flex items-end gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={zwischenfutter}
            onChange={(e) => setZwischenfutter(e.target.checked)}
          />
          Zwischenfutter
        </label>
      </div>
      <label className="block text-sm">
        Kultur
        <select
          value={kulturCode}
          onChange={(e) => setKulturCode(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 p-2"
        >
          <option value="" disabled>
            Kultur wählen…
          </option>
          {cropOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
          <option value="__custom__">— eigene Eingabe —</option>
        </select>
      </label>
      {kulturCode === '__custom__' && (
        <input
          type="text"
          placeholder="Kulturname"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          className="w-full rounded border border-gray-300 p-2 text-sm"
        />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Speichere…' : 'Planen'}
        </button>
        <button type="button" onClick={() => setShow(false)} className="px-3 py-1.5 text-sm text-gray-500">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
