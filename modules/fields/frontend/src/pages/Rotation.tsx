import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { softDeleteRow, upsertRow } from '../db/write'
import { useHasPermission } from '@fmis/core/AuthContext'
import { fmtArea, num } from '../lib/format'
import { classifyKultur, isGeholz, KULTUR_CATEGORY_LABEL, type KulturCategory } from '../lib/kulturCategory'
import RotationTimeline from '../components/RotationTimeline'
import Modal from '../components/Modal'
import OelnCheck from '../components/OelnCheck'
import PlanDialog, { type CropOption } from '../components/PlanDialog'
import { checkYear, parcelHints, ruleText, type MainCrop } from '../lib/rotationRules'
import type { FieldDeclaration, FieldLineageSummary } from '../types'
import NumberInput from '@fmis/core/NumberInput'
import { errorText, notifyError } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'

const FILTERS: ('alle' | KulturCategory)[] = ['alle', 'acker', 'futter']
const FILTER_LABEL: Record<'alle' | KulturCategory, string> = {
  alle: 'Alle',
  acker: KULTUR_CATEGORY_LABEL.acker,
  futter: KULTUR_CATEGORY_LABEL.futter,
  andere: KULTUR_CATEGORY_LABEL.andere,
}

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

async function loadFarms(pg: PGlite): Promise<Map<string, string>> {
  const { rows } = await pg.query<{ id: string; name: string }>('select id, name from farms where deleted_at is null')
  return new Map(rows.map((r) => [r.id, r.name]))
}

export default function Rotation() {
  // Kultur planen schreibt — ohne Recht (Rolle Mitarbeit) nur ansehen
  const canWrite = useHasPermission('fields:fields:write')
  const navigate = useNavigate()
  const { data: lineages } = useQuery(loadLineages)
  const { data: declarations, refresh } = useQuery(loadDeclarations)
  const { data: farmNames } = useQuery(loadFarms)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [planning, setPlanning] = useState(false)
  const [filter, setFilter] = useState<'alle' | KulturCategory>('alle')
  const [showGeholz, setShowGeholz] = useState(false)
  const [detailsLineage, setDetailsLineage] = useState<FieldLineageSummary | null>(null)

  const byLineage = useMemo(() => {
    const map = new Map<string, FieldDeclaration[]>()
    for (const d of declarations ?? []) {
      const list = map.get(d.lineage_id) ?? []
      list.push(d)
      map.set(d.lineage_id, list)
    }
    return map
  }, [declarations])

  // Filtert nach der Kultur der jüngsten Deklaration je Parzelle (die
  // v_field_lineage_summary-Zeile selbst) — eine Parzelle kann über die
  // Jahre zwischen Acker- und Futternutzung wechseln, "Alle" zeigt
  // trotzdem immer die volle Historie inkl. früherer Nutzungsarten.
  // Gehölze (Obst-/Nussbäume, Hecken, Wald) sind standardmässig ausgeblendet,
  // da sie nicht rotieren und den Zeitstrahl sonst zumüllen — eigener
  // Umschalter, unabhängig vom Acker-/Futterfläche-Filter.
  const filteredLineages = useMemo(() => {
    return (lineages ?? []).filter((l) => {
      if (filter !== 'alle' && classifyKultur(l.kultur_code) !== filter) return false
      if (!showGeholz && isGeholz(l.kultur_code)) return false
      return true
    })
  }, [lineages, filter, showGeholz])

  // ÖLN-Fruchtfolge (lib/rotationRules.ts): je Betrieb und Jahr, und Anbaupausen je Parzelle
  const mainCrops = useMemo<MainCrop[]>(() => (declarations ?? []).map((d) => ({ ...d })), [declarations])
  const oeln = useMemo(() => {
    // ÖLN gilt je Betrieb; Zeilen ohne bekannten Betrieb (alter Stand auf dem Gerät) zählen nicht
    const farmIds = [...new Set(mainCrops.map((c) => c.farm_id))].filter((id) => farmNames?.has(id))
    return farmIds
      .map((id) => {
        const crops = mainCrops.filter((c) => c.farm_id === id)
        const years = [...new Set(crops.map((c) => c.jahr))].sort((a, b) => b - a)
        return { name: farmNames?.get(id) ?? '', checks: years.map((y) => checkYear(y, crops)).filter((c) => c.arableHa > 0) }
      })
      .filter((f) => f.checks.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }, [mainCrops, farmNames])
  const plannedYears = useMemo(() => new Set((declarations ?? []).filter((d) => d.source === 'plan').map((d) => d.jahr)), [declarations])
  const hints = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const h of parcelHints(mainCrops)) {
      const k = `${h.lineage_id}|${h.jahr}`
      m.set(k, [...(m.get(k) ?? []), ruleText(h.rule)])
    }
    return m
  }, [mainCrops])
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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

  const detailsRows = detailsLineage ? (byLineage.get(detailsLineage.lineage_id) ?? []) : []

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Fruchtfolge</h1>

      <OelnCheck farms={oeln} plannedYears={plannedYears} />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === f ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 shadow-sm'
            }`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showGeholz}
            onChange={(e) => setShowGeholz(e.target.checked)}
          />
          Gehölze (Obst, Hecken, Wald)
        </label>
      </div>

      {filteredLineages.length === 0 ? (
        <p className="text-center text-gray-500">Keine Parzellen für diesen Filter.</p>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-500">Zeitstrahl</h2>
            <span className="text-xs text-gray-500">
              <span className="text-red-600">|</span> heute · gestrichelt = geplant · <span className="text-amber-700">⚠</span> Anbaupause
            </span>
          </div>
          {canWrite && (
            <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-20 mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/95 p-2 text-sm shadow-sm">
              {selected.size === 0 ? (
                <span className="text-gray-500">Parzellen ankreuzen, um gemeinsam zu planen.</span>
              ) : (
                <>
                  <button type="button" onClick={() => setPlanning(true)} className="min-h-11 rounded-lg bg-brand-700 px-3 font-semibold text-white">
                    {selected.size} {selected.size === 1 ? 'Parzelle' : 'Parzellen'} planen…
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} className="min-h-11 px-2 text-gray-600">
                    Auswahl aufheben
                  </button>
                </>
              )}
            </div>
          )}
          <RotationTimeline
            lineages={filteredLineages}
            declarationsByLineage={byLineage}
            hints={hints}
            selected={canWrite ? selected : undefined}
            onToggle={canWrite ? toggle : undefined}
            onFocusMap={(lineage) =>
              navigate('/fields', { state: { focusLineageId: lineage.lineage_id, focusJahr: lineage.latest_jahr } })
            }
            onOpenDetails={(lineage) => setDetailsLineage(lineage)}
          />
        </div>
      )}

      {planning && (
        <PlanDialog
          lineages={(lineages ?? []).filter((l) => selected.has(l.lineage_id))}
          byLineage={byLineage}
          allCrops={mainCrops}
          cropOptions={cropOptions}
          onClose={(saved) => {
            setPlanning(false)
            if (saved) setSelected(new Set())
          }}
        />
      )}

      {detailsLineage && (
        <Modal
          title={detailsLineage.flurname ?? detailsLineage.kultur_name_de ?? detailsLineage.kultur_code}
          onClose={() => setDetailsLineage(null)}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-1 pr-2 font-medium">Jahr</th>
                <th className="py-1 pr-2 font-medium">Kultur</th>
                <th className="py-1 pr-2 font-medium">Sorte</th>
                <th className="py-1 pr-2 font-medium">Fläche</th>
                <th className="py-1 font-medium">Quelle</th>
              </tr>
            </thead>
            <tbody>
              {detailsRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1 pr-2 text-gray-600">
                    {r.jahr}
                    {r.sequence_in_year > 1 ? ` (${r.sequence_in_year}.)` : ''}
                  </td>
                  <td className="py-1 pr-2 text-gray-800">{r.kultur_name_de ?? r.kultur_code}</td>
                  <td className="py-1 pr-2 text-gray-600">{r.sorte ?? '–'}</td>
                  <td className="py-1 pr-2 text-gray-600">{fmtArea(r.area_a)}</td>
                  <td className="py-1 text-gray-500">
                    {SOURCE_LABEL[r.source]}
                    {canWrite && r.source === 'plan' && (
                      <button
                        type="button"
                        onClick={() =>
                          void undoAction(`Planung gelöscht: ${r.kultur_name_de ?? r.kultur_code} ${r.jahr}`, () => softDeleteRow('field_declarations', r.id)).catch((e) =>
                            notifyError(errorText(e)),
                          )
                        }
                        className="ml-1 rounded px-1 text-red-700"
                        title="Planung löschen"
                        aria-label={`Planung ${r.jahr} löschen`}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canWrite && <PlanForm
            lineage={detailsLineage}
            latestDeclaration={detailsRows[0]}
            existingYears={detailsRows.map((r) => r.jahr)}
            cropOptions={cropOptions}
            onPlanned={refresh}
          />}
        </Modal>
      )}
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
  const [sorte, setSorte] = useState('')
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
        sorte: sorte.trim() || null,
        source: 'plan',
      })
      setShow(false)
      setKulturCode('')
      setCustomName('')
      setSorte('')
      setZwischenfutter(false)
      onPlanned()
    } catch (err) {
      setError(errorText(err, 'Planen fehlgeschlagen'))
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
          <NumberInput
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
      <label className="block text-sm">
        Sorte (optional)
        <input
          type="text"
          placeholder="z.B. Runal"
          value={sorte}
          onChange={(e) => setSorte(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
        />
      </label>
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
