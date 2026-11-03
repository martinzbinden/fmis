import { useMemo, useState } from 'react'
import NumberInput from '@fmis/core/NumberInput'
import { errorText, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import Modal from './Modal'
import { upsertRows } from '../db/write'
import { parcelHints, ruleText, type MainCrop } from '../lib/rotationRules'
import type { FieldDeclaration, FieldLineageSummary } from '../types'

export interface CropOption {
  code: string
  name: string
}

/** Eine Kultur für mehrere Parzellen und auf Wunsch wiederkehrend planen
 * («alle n Jahre bis …»). Importierte Jahre bleiben unberührt; eine schon
 * geplante Hauptkultur im selben Jahr wird ersetzt. Vorschau der
 * Anbaupausen vor dem Speichern. */
export default function PlanDialog({
  lineages,
  byLineage,
  allCrops,
  cropOptions,
  onClose,
}: {
  lineages: FieldLineageSummary[]
  byLineage: Map<string, FieldDeclaration[]>
  allCrops: MainCrop[]
  cropOptions: CropOption[]
  onClose: (saved: boolean) => void
}) {
  const maxYear = Math.max(new Date().getFullYear(), ...lineages.flatMap((l) => (byLineage.get(l.lineage_id) ?? []).map((d) => d.jahr)))
  const [year, setYear] = useState(String(maxYear + 1))
  const [kulturCode, setKulturCode] = useState('')
  const [customName, setCustomName] = useState('')
  const [sorte, setSorte] = useState('')
  const [zwischenfutter, setZwischenfutter] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [every, setEvery] = useState('4')
  const [until, setUntil] = useState(String(maxYear + 8))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCustom = kulturCode === '__custom__'
  const code = isCustom ? customName.trim() : kulturCode
  const name = isCustom ? customName.trim() : cropOptions.find((o) => o.code === kulturCode)?.name

  const years = useMemo(() => {
    const start = Number(year)
    if (!Number.isInteger(start)) return []
    if (!repeat) return [start]
    const step = Number(every)
    const end = Number(until)
    if (!Number.isInteger(step) || step < 1 || !Number.isInteger(end) || end < start) return [start]
    const out: number[] = []
    for (let y = start; y <= end && out.length < 30; y += step) out.push(y)
    return out
  }, [year, repeat, every, until])

  // Was geschrieben würde: je Parzelle und Jahr eine Zeile (neu oder ersetzt), importierte Jahre übersprungen
  const plan = useMemo(() => {
    const rows: FieldDeclaration[] = []
    const skipped: string[] = []
    if (!code) return { rows, skipped }
    for (const l of lineages) {
      const decls = byLineage.get(l.lineage_id) ?? []
      const latest = [...decls].sort((a, b) => b.jahr - a.jahr || a.sequence_in_year - b.sequence_in_year)[0]
      for (const y of years) {
        const sameYear = decls.filter((d) => d.jahr === y)
        const main = sameYear.find((d) => d.sequence_in_year === 1)
        if (!zwischenfutter && main?.source === 'import') {
          skipped.push(`${l.flurname ?? l.kultur_name_de ?? l.kultur_code} ${y}`)
          continue
        }
        const base = !zwischenfutter && main ? main : null
        rows.push({
          ...(base ?? {}),
          id: base?.id ?? crypto.randomUUID(),
          farm_id: l.farm_id,
          lineage_id: l.lineage_id,
          management_unit_external_id: latest?.management_unit_external_id ?? null,
          external_kultur_id: null,
          jahr: y,
          sequence_in_year: zwischenfutter ? sameYear.length + 1 : 1,
          kultur_code: code,
          kultur_name_de: name ?? code,
          kultur_name_fr: null,
          flurname: latest?.flurname ?? l.flurname ?? null,
          area_a: latest?.area_a ?? null,
          baeume: null,
          geometry: latest?.geometry ?? null,
          source: 'plan',
          notes: base?.notes ?? null,
          start_date: null,
          end_date: null,
          sorte: sorte.trim() || null,
        } as FieldDeclaration)
      }
    }
    return { rows, skipped }
  }, [code, name, sorte, zwischenfutter, years, lineages, byLineage])

  // Vorschau: Anbaupausen der ausgewählten Parzellen mit dem Plan
  const preview = useMemo(() => {
    if (zwischenfutter || plan.rows.length === 0) return []
    const ids = new Set(lineages.map((l) => l.lineage_id))
    const replaced = new Set(plan.rows.map((r) => `${r.lineage_id}|${r.jahr}`))
    const crops = [
      ...allCrops.filter((c) => ids.has(c.lineage_id) && !(c.sequence_in_year === 1 && replaced.has(`${c.lineage_id}|${c.jahr}`))),
      ...plan.rows,
    ]
    const label = new Map(lineages.map((l) => [l.lineage_id, l.flurname ?? l.kultur_name_de ?? l.kultur_code]))
    // je Parzelle und Regel eine Zeile mit allen betroffenen Jahren
    const grouped = new Map<string, { lineage: string; text: string; years: Set<number> }>()
    for (const h of parcelHints(crops)) {
      if (!plan.rows.some((r) => r.lineage_id === h.lineage_id && h.years.includes(r.jahr))) continue
      const k = `${h.lineage_id}|${h.rule.group}`
      const g = grouped.get(k) ?? { lineage: h.lineage_id, text: ruleText(h.rule), years: new Set<number>() }
      h.years.forEach((y) => g.years.add(y))
      grouped.set(k, g)
    }
    return [...grouped.values()].map((g) => `${label.get(g.lineage)}: ${g.text} — ${[...g.years].sort().join(', ')}`)
  }, [plan.rows, allCrops, lineages, zwischenfutter])

  async function save() {
    if (!code) {
      setError('Bitte eine Kultur wählen oder eingeben.')
      return
    }
    if (plan.rows.length === 0) {
      setError('Nichts zu planen — alle gewählten Jahre sind schon importiert.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await undoAction(`Fruchtfolge geplant: ${name ?? code}`, () => upsertRows('field_declarations', plan.rows as never))
      notifySuccess(`${plan.rows.length} ${plan.rows.length === 1 ? 'Eintrag' : 'Einträge'} geplant`)
      onClose(true)
    } catch (e) {
      setError(errorText(e, 'Planen fehlgeschlagen'))
    } finally {
      setBusy(false)
    }
  }

  const input = 'mt-1 min-h-11 w-full rounded border border-gray-300 px-2 text-base'

  return (
    <Modal title={`Planen: ${lineages.length} ${lineages.length === 1 ? 'Parzelle' : 'Parzellen'}`} onClose={() => onClose(false)}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="text-xs text-gray-500">{lineages.map((l) => l.flurname ?? l.kultur_name_de ?? l.kultur_code).join(', ')}</p>
        <label className="block text-sm">
          Kultur
          <select value={kulturCode} onChange={(e) => setKulturCode(e.target.value)} className={`${input} bg-white`}>
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
        {isCustom && (
          <input type="text" placeholder="Kulturname" value={customName} onChange={(e) => setCustomName(e.target.value)} className={input} />
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-28 text-sm">
            {repeat ? 'Ab Jahr' : 'Jahr'}
            <NumberInput value={year} onChange={(e) => setYear(e.target.value)} className={input} />
          </label>
          <label className="flex min-h-11 items-center gap-1.5 text-sm">
            <input type="checkbox" checked={zwischenfutter} onChange={(e) => setZwischenfutter(e.target.checked)} />
            Zwischenfutter
          </label>
          <label className="flex min-h-11 items-center gap-1.5 text-sm">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            wiederholen
          </label>
        </div>
        {repeat && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="w-28 text-sm">
              alle … Jahre
              <NumberInput value={every} onChange={(e) => setEvery(e.target.value)} className={input} />
            </label>
            <label className="w-28 text-sm">
              bis Jahr
              <NumberInput value={until} onChange={(e) => setUntil(e.target.value)} className={input} />
            </label>
            <span className="pb-3 text-xs text-gray-500">{years.join(', ')}</span>
          </div>
        )}
        <label className="block text-sm">
          Sorte (optional)
          <input type="text" value={sorte} onChange={(e) => setSorte(e.target.value)} className={input} />
        </label>

        {code && (
          <div className="space-y-1 rounded bg-gray-50 p-2 text-xs">
            <div className="text-gray-700">
              {plan.rows.length} {plan.rows.length === 1 ? 'Eintrag' : 'Einträge'}
              {plan.rows.some((r) => (byLineage.get(r.lineage_id) ?? []).some((d) => d.id === r.id)) && ' (bestehende Planung im selben Jahr wird ersetzt)'}
            </div>
            {plan.skipped.length > 0 && <div className="text-gray-500">Übersprungen, schon importiert: {plan.skipped.join(', ')}</div>}
            {preview.length === 0 ? (
              !zwischenfutter && <div className="text-green-800">✓ Anbaupausen eingehalten</div>
            ) : (
              preview.map((p) => (
                <div key={p} className="text-amber-800">
                  ⚠ {p}
                </div>
              ))
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Speichere…' : 'Planen'}
          </button>
          <button type="button" onClick={() => onClose(false)} className="min-h-11 px-3 text-sm text-gray-500">
            Abbrechen
          </button>
        </div>
      </form>
    </Modal>
  )
}
