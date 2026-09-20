import { useState } from 'react'
import { saveNewVersion } from '../lib/planLayer'
import { fmtArea } from '../lib/format'
import type { PlanParcel } from '../types'

interface CropOption {
  code: string
  name: string
}

/**
 * Tabellarische Übersicht der Planungsparzellen des aktiven Layers,
 * inline editierbar (Änderung speichert sofort eine neue Version über
 * lib/planLayer.ts — dieselbe Versionierung wie Karte und Detail-Modal).
 * Ergänzt die Karte, ersetzt sie nicht: Versionshistorie/Wiederherstellen
 * bleibt im bestehenden PlanParcelDetails-Modal (☰-Spalte).
 */
export default function PlanAttributeTable({
  planParcels,
  cropOptions,
  selectedIds,
  onToggleSelect,
  onFocusMap,
  onOpenDetails,
  onChanged,
}: {
  planParcels: PlanParcel[]
  cropOptions: CropOption[]
  selectedIds: Set<string>
  onToggleSelect: (planId: string) => void
  onFocusMap: (planId: string) => void
  onOpenDetails: (planId: string) => void
  onChanged: () => void
}) {
  if (planParcels.length === 0) {
    return <p className="text-center text-sm text-gray-400">Dieser Layer hat noch keine Parzellen.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="w-8 py-2 pl-3" />
            <th className="px-2 py-2 font-medium">Flurname</th>
            <th className="px-2 py-2 font-medium">Jahr</th>
            <th className="px-2 py-2 font-medium">Kultur</th>
            <th className="px-2 py-2 font-medium">Sorte</th>
            <th className="px-2 py-2 font-medium">Fläche</th>
            <th className="w-16 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {planParcels.map((p) => (
            <PlanAttributeRow
              // Nach Version-Id statt plan_id geschlüsselt: erzwingt einen
              // Remount (und damit frische lokale Eingabe-States) bei JEDER
              // neuen Version — auch wenn die Änderung von woanders kam
              // (Bulk-Bearbeiten, Detail-Modal, Wiederherstellen). Ohne das
              // blieben bearbeitete Felder in der Tabelle sichtbar veraltet.
              key={p.id}
              plan={p}
              cropOptions={cropOptions}
              selected={selectedIds.has(p.plan_id)}
              onToggleSelect={() => onToggleSelect(p.plan_id)}
              onFocusMap={() => onFocusMap(p.plan_id)}
              onOpenDetails={() => onOpenDetails(p.plan_id)}
              onChanged={onChanged}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanAttributeRow({
  plan,
  cropOptions,
  selected,
  onToggleSelect,
  onFocusMap,
  onOpenDetails,
  onChanged,
}: {
  plan: PlanParcel
  cropOptions: CropOption[]
  selected: boolean
  onToggleSelect: () => void
  onFocusMap: () => void
  onOpenDetails: () => void
  onChanged: () => void
}) {
  const [flurname, setFlurname] = useState(plan.flurname ?? '')
  const [jahr, setJahr] = useState(String(plan.jahr))
  const [sorte, setSorte] = useState(plan.sorte ?? '')
  const [customKultur, setCustomKultur] = useState('')
  const [showCustomKultur, setShowCustomKultur] = useState(
    plan.kultur_code != null && !cropOptions.some((o) => o.code === plan.kultur_code),
  )

  async function commitFlurname() {
    const next = flurname.trim() || null
    if (next !== plan.flurname) {
      await saveNewVersion(plan.plan_id, { flurname: next })
      onChanged()
    }
  }

  async function commitJahr() {
    const next = Number(jahr)
    if (Number.isInteger(next) && next !== plan.jahr) {
      await saveNewVersion(plan.plan_id, { jahr: next })
      onChanged()
    } else {
      setJahr(String(plan.jahr))
    }
  }

  async function commitSorte() {
    const next = sorte.trim() || null
    if (next !== plan.sorte) {
      await saveNewVersion(plan.plan_id, { sorte: next })
      onChanged()
    }
  }

  async function commitKulturCode(code: string) {
    if (code === '__custom__') {
      setShowCustomKultur(true)
      return
    }
    setShowCustomKultur(false)
    const name = cropOptions.find((o) => o.code === code)?.name ?? code
    await saveNewVersion(plan.plan_id, { kultur_code: code || null, kultur_name_de: code ? name : null })
    onChanged()
  }

  async function commitCustomKultur() {
    const name = customKultur.trim()
    if (!name || name === plan.kultur_code) return
    await saveNewVersion(plan.plan_id, { kultur_code: name, kultur_name_de: name })
    setCustomKultur('')
    onChanged()
  }

  return (
    <tr className={`border-b last:border-0 ${selected ? 'bg-brand-50' : ''}`}>
      <td className="py-1 pl-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          value={flurname}
          onChange={(e) => setFlurname(e.target.value)}
          onBlur={commitFlurname}
          className="w-28 rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gray-400"
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(e.target.value)}
          onBlur={commitJahr}
          className="w-16 rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gray-400"
        />
      </td>
      <td className="px-2 py-1">
        <select
          value={showCustomKultur ? '__custom__' : (plan.kultur_code ?? '')}
          onChange={(e) => void commitKulturCode(e.target.value)}
          className="w-32 rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gray-400"
        >
          <option value="">— keine —</option>
          {cropOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
          <option value="__custom__">— eigene Eingabe —</option>
        </select>
        {showCustomKultur && (
          <input
            type="text"
            placeholder="Kulturname"
            defaultValue={plan.kultur_code ?? ''}
            onChange={(e) => setCustomKultur(e.target.value)}
            onBlur={commitCustomKultur}
            className="mt-0.5 block w-32 rounded border border-gray-300 px-1 py-0.5 text-xs"
          />
        )}
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          value={sorte}
          onChange={(e) => setSorte(e.target.value)}
          onBlur={commitSorte}
          className="w-24 rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gray-400"
        />
      </td>
      <td className="px-2 py-1 text-gray-500">{fmtArea(plan.area_a)}</td>
      <td className="px-2 py-1 text-right">
        <button type="button" onClick={onFocusMap} title="Auf Karte zeigen" className="px-1">
          🌐
        </button>
        <button type="button" onClick={onOpenDetails} title="Details / Versionen" className="px-1">
          ☰
        </button>
      </td>
    </tr>
  )
}
