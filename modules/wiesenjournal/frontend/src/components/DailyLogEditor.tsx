import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'
import { fmtDate } from '../lib/format'
import Modal from './Modal'
import type { DailyFarmLog } from '../types'

export default function DailyLogEditor({
  date,
  onClose,
  onSaved,
}: {
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const [existing, setExisting] = useState<DailyFarmLog | null>(null)
  const [laufhofKuehe, setLaufhofKuehe] = useState(false)
  const [laufhofRinder, setLaufhofRinder] = useState(false)
  const [wetterCode, setWetterCode] = useState('')
  const [niederschlag, setNiederschlag] = useState('')
  const [mondPhase, setMondPhase] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pg = await getDb()
      const { rows } = await pg.query<DailyFarmLog>(
        'select * from daily_farm_log where entry_date = $1 and deleted_at is null limit 1',
        [date],
      )
      if (cancelled) return
      const e = rows[0] ?? null
      setExisting(e)
      setLaufhofKuehe(!!e?.laufhof_kuehe)
      setLaufhofRinder(!!e?.laufhof_rinder)
      setWetterCode(e?.wetter_code ?? '')
      setNiederschlag(e?.niederschlag_mm == null ? '' : String(e.niederschlag_mm))
      setMondPhase(e?.mond_phase ?? '')
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [date])

  async function save() {
    setSaving(true)
    try {
      await upsertRow('daily_farm_log', {
        id: existing?.id ?? crypto.randomUUID(),
        entry_date: date,
        laufhof_kuehe: laufhofKuehe,
        laufhof_rinder: laufhofRinder,
        wetter_code: wetterCode.trim() || null,
        niederschlag_mm: niederschlag ? Number(niederschlag) : null,
        mond_phase: mondPhase.trim() || null,
        notes: null,
      } as never)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Tagesmeldung · ${fmtDate(date)}`} onClose={onClose}>
      {loading ? (
        <p className="py-4 text-center text-gray-400">Lädt…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={laufhofKuehe} onChange={(e) => setLaufhofKuehe(e.target.checked)} />
              Laufhof Kühe
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={laufhofRinder} onChange={(e) => setLaufhofRinder(e.target.checked)} />
              Laufhof Rinder
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Wetter</span>
            <input
              type="text"
              placeholder="z.B. sonnig, bewölkt, Regen"
              value={wetterCode}
              onChange={(e) => setWetterCode(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Niederschlag (mm)</span>
            <input
              type="number"
              step="0.1"
              value={niederschlag}
              onChange={(e) => setNiederschlag(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Mond</span>
            <input
              type="text"
              placeholder="z.B. zunehmend, Vollmond"
              value={mondPhase}
              onChange={(e) => setMondPhase(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
