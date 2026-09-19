import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { deletePlanParcel, loadVersionHistory, revertToVersion, saveNewVersion } from '../lib/planLayer'
import { fmtArea, fmtDateTime, num } from '../lib/format'
import type { Farm, PlanParcel } from '../types'

interface CropOption {
  code: string
  name: string
}

/**
 * Formular (Betrieb/Jahr/Kultur/Sorte) + Versionshistorie für eine
 * Planungsparzelle. Jede Speicherung/Wiederherstellung legt über
 * lib/planLayer.ts automatisch eine neue Version an — die Liste hier
 * zeigt alle bisherigen Versionen, älteste zuletzt.
 */
export default function PlanParcelDetails({
  planId,
  farms,
  cropOptions,
  onClose,
  onChanged,
}: {
  planId: string
  farms: Farm[]
  cropOptions: CropOption[]
  onClose: () => void
  onChanged: () => void
}) {
  const [current, setCurrent] = useState<PlanParcel | null>(null)
  const [history, setHistory] = useState<PlanParcel[]>([])
  const [farmId, setFarmId] = useState('')
  const [jahr, setJahr] = useState('')
  const [kulturCode, setKulturCode] = useState('')
  const [customName, setCustomName] = useState('')
  const [sorte, setSorte] = useState('')
  const [flurname, setFlurname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    const pg = await getDb()
    const { rows } = await pg.query<PlanParcel>(`select * from plan_parcels where plan_id = $1 and is_current`, [
      planId,
    ])
    const row = rows[0] ?? null
    setCurrent(row ? { ...row, area_a: num(row.area_a) } : null)
    if (row) {
      setFarmId(row.farm_id)
      setJahr(String(row.jahr))
      setKulturCode(row.kultur_code ?? '')
      setSorte(row.sorte ?? '')
      setFlurname(row.flurname ?? '')
    }
    setHistory((await loadVersionHistory(planId)).map((v) => ({ ...v, area_a: num(v.area_a) })))
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const jahrNum = Number(jahr)
    if (!Number.isInteger(jahrNum)) {
      setError('Bitte ein gültiges Jahr angeben.')
      return
    }
    const isCustom = kulturCode === '__custom__'
    const name = isCustom ? customName.trim() : cropOptions.find((o) => o.code === kulturCode)?.name
    const code = isCustom ? customName.trim() : kulturCode
    setBusy(true)
    setError(null)
    try {
      await saveNewVersion(planId, {
        farm_id: farmId,
        jahr: jahrNum,
        kultur_code: code || null,
        kultur_name_de: name ?? code ?? null,
        kultur_name_fr: null,
        sorte: sorte.trim() || null,
        flurname: flurname.trim() || null,
      })
      setCustomName('')
      await reload()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevert(versionNumber: number) {
    setBusy(true)
    setError(null)
    try {
      await revertToVersion(planId, versionNumber)
      await reload()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wiederherstellen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      await deletePlanParcel(planId)
      onChanged()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
      setBusy(false)
    }
  }

  if (!current) return <p className="text-sm text-gray-400">Lädt…</p>

  return (
    <div className="space-y-4">
      <form onSubmit={handleSave} className="space-y-2">
        <label className="block text-sm">
          Betrieb
          <select
            value={farmId}
            onChange={(e) => setFarmId(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          >
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Flurname
          <input
            type="text"
            value={flurname}
            onChange={(e) => setFlurname(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <label className="block text-sm">
          Jahr
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        <label className="block text-sm">
          Kultur
          <select
            value={kulturCode}
            onChange={(e) => setKulturCode(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          >
            <option value="">— keine —</option>
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
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </label>
        {current.area_a != null && <p className="text-xs text-gray-500">Fläche: {fmtArea(current.area_a)}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Speichere…' : 'Speichern'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
          >
            Löschen
          </button>
        </div>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-500">
          Versionen ({history.length}) — jede Änderung wird automatisch gespeichert
        </h3>
        <ul className="space-y-1">
          {history.map((v) => (
            <li
              key={v.id}
              className={`flex items-center justify-between rounded p-2 text-xs ${
                v.is_current ? 'bg-brand-50' : 'bg-gray-50'
              }`}
            >
              <span>
                V{v.version_number} · {fmtDateTime(v.updated_at)}
                {v.deleted_at ? ' · gelöscht' : ''} · {v.kultur_name_de ?? v.kultur_code ?? 'ohne Kultur'}
                {v.is_current ? ' (aktuell)' : ''}
              </span>
              {!v.is_current && (
                <button
                  type="button"
                  onClick={() => handleRevert(v.version_number)}
                  disabled={busy}
                  className="text-brand-700 underline disabled:opacity-50"
                >
                  wiederherstellen
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
