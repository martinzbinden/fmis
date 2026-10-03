import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'
import { ANIMAL_CATEGORIES, ANIMAL_CATEGORY_LABEL, fmtDate } from '../lib/format'
import { loadHerdData } from '../lib/herds'
import { accessIndex, categoryDay, categoryMark, categoryTitle, type CategoryDay } from '../lib/outdoorAccess'
import Modal from './Modal'
import type { AnimalCategory, DailyFarmLog } from '../types'

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
  // Laufhof je Tierkategorie — Spalten laufhof_<kategorie> (schema/0008).
  const [laufhof, setLaufhof] = useState<Record<string, boolean>>({})
  const [animalCounts, setAnimalCounts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [wetterCode, setWetterCode] = useState('')
  const [niederschlag, setNiederschlag] = useState('')
  const [mondPhase, setMondPhase] = useState('')
  const [wetterQuelle, setWetterQuelle] = useState<'geodaten' | 'manuell'>('manuell')
  const [loading, setLoading] = useState(true)
  // Aus den Herdengruppen: Tiere und Auslauf je Kategorie (lib/outdoorAccess.ts)
  const [herd, setHerd] = useState<Map<AnimalCategory, CategoryDay>>(new Map())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pg = await getDb()
      const { rows } = await pg.query<DailyFarmLog>(
        'select * from daily_farm_log where entry_date = $1 and deleted_at is null limit 1',
        [date],
      )
      const herdData = await loadHerdData(pg)
      if (cancelled) return
      setHerd(categoryDay(accessIndex(herdData), herdData, date))
      const e = rows[0] ?? null
      setExisting(e)
      const lh: Record<string, boolean> = {}
      for (const c of ANIMAL_CATEGORIES) lh[c] = !!(e as unknown as Record<string, unknown> | null)?.[`laufhof_${c}`]
      setLaufhof(lh)
      let counts: Record<string, unknown> = {}
      try {
        counts = e?.animal_counts ? (JSON.parse(e.animal_counts) as Record<string, unknown>) : {}
      } catch {
        counts = {}
      }
      setAnimalCounts(Object.fromEntries(ANIMAL_CATEGORIES.map((c) => [c, counts[c] == null ? '' : String(counts[c])])))
      setNotes(e?.notes ?? '')
      setWetterCode(e?.wetter_code ?? '')
      setNiederschlag(e?.niederschlag_mm == null ? '' : String(e.niederschlag_mm))
      setMondPhase(e?.mond_phase ?? '')
      setWetterQuelle(e?.wetter_quelle ?? 'manuell')
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
        ...Object.fromEntries(ANIMAL_CATEGORIES.map((c) => [`laufhof_${c}`, !!laufhof[c]])),
        wetter_code: wetterCode.trim() || null,
        niederschlag_mm: niederschlag ? Number(niederschlag) : null,
        mond_phase: mondPhase.trim() || null,
        // Eine Eingabe hier ist per Definition lokal — überschreibt einen
        // automatisch vom (künftigen) Geodatenserver gesetzten Wert und hat
        // danach Vorrang.
        wetter_quelle: 'manuell',
        notes: notes.trim() || null,
        animal_counts: Object.values(animalCounts).some((v) => v.trim() !== '')
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries(animalCounts)
                  .filter(([, v]) => v.trim() !== '')
                  .map(([k, v]) => [k, Number(v)]),
              ),
            )
          : null,
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
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Laufhof / Auslauf</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {ANIMAL_CATEGORIES.map((c) => {
                const h = herd.get(c)
                const mark = categoryMark(h)
                return (
                  <label key={c} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!laufhof[c]}
                      onChange={(e) => setLaufhof((s) => ({ ...s, [c]: e.target.checked }))}
                    />
                    <span>
                      {ANIMAL_CATEGORY_LABEL[c]}
                      {h && (
                        <span title={categoryTitle(h)} className={`block text-xs ${mark === '✓' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          Herden: {h.withAccess} von {h.animals} {mark ?? ''}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
            {herd.size > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                Aus den Herden (Weide, Laufhof, Ställe mit ständigem Laufhof) — gilt ohne Häkchen. Laufhofgänge je Gruppe unter{' '}
                <Link to="../herden" className="text-brand-700 underline">
                  Herden
                </Link>{' '}
                oder im{' '}
                <Link to="../auslauf" className="text-brand-700 underline">
                  Auslaufjournal
                </Link>
                .
              </p>
            )}
          </div>
          {wetterQuelle === 'geodaten' && (wetterCode || niederschlag) && (
            <p className="rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">
              🛰 Automatisch vom Geodatenserver übernommen — eine Änderung hier ersetzt das dauerhaft durch deine Eingabe.
            </p>
          )}
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
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Anzahl Tiere (optional{herd.size > 0 ? ', leer = aus den Herden' : ''})</span>
            <div className="grid grid-cols-3 gap-2">
              {ANIMAL_CATEGORIES.map((c) => (
                <label key={c} className="text-xs text-gray-600">
                  {ANIMAL_CATEGORY_LABEL[c]}
                  <input
                    type="number"
                    placeholder={herd.get(c) ? String(herd.get(c)!.animals) : undefined}
                    value={animalCounts[c] ?? ''}
                    onChange={(e) => setAnimalCounts((s) => ({ ...s, [c]: e.target.value }))}
                    className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Notizen</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
