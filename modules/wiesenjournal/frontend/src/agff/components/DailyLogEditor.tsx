// Aus fmis components/DailyLogEditor.tsx (59425bb), ohne Herden.
import { useEffect, useState } from 'react'
import { db, getDb } from '../db/db'
import { upsertRow } from '../db/write'
import { ANIMAL_CATEGORIES, ANIMAL_CATEGORY_LABEL, fmtDate } from '../lib/format'
import Modal from './Modal'
import type { DailyFarmLog, LaufhofWert } from '../types'
import { ausnahmenAm, ausnahmeText } from '../lib/laufhof'
import { useRegen } from '../hooks/useRegen'
import { fmtRegen, regenAm, regenStand, REGEN_QUELLE } from '../lib/regen'

function getAusnahmen() {
  return db().rows('auslauf_ausnahmen')
}

export default function DailyLogEditor({ date, onClose }: { date: string; onClose: () => void }) {
  const [existing, setExisting] = useState<DailyFarmLog | null>(null)
  const [laufhof, setLaufhof] = useState<Record<string, LaufhofWert>>({})
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [wetter, setWetter] = useState('')
  const [regen, setRegen] = useState('')
  const [mond, setMond] = useState('')
  const [loading, setLoading] = useState(true)
  // automatisch von graswachstum.ch (lib/regen.ts); ein Eintrag hier geht vor
  const regenSpeicher = useRegen(Number(date.slice(0, 4)))
  const regenAuto = regenAm(regenSpeicher, date)
  const regenBis = regenStand(regenSpeicher[date.slice(0, 4)])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const st = await getDb()
      if (cancelled) return
      const e = st.rows('daily_farm_log').find((l) => l.entry_date === date) ?? null
      setExisting(e)
      const rec = e as unknown as Record<string, unknown> | null
      setLaufhof(Object.fromEntries(ANIMAL_CATEGORIES.map((c) => [c, (rec?.[`laufhof_${c}`] as LaufhofWert) ?? null])))
      let parsed: Record<string, unknown> = {}
      try {
        parsed = e?.animal_counts ? (JSON.parse(e.animal_counts) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      setCounts(Object.fromEntries(ANIMAL_CATEGORIES.map((c) => [c, parsed[c] == null ? '' : String(parsed[c])])))
      setNotes(e?.notes ?? '')
      setWetter(e?.wetter_code ?? '')
      setRegen(e?.niederschlag_mm == null ? '' : String(Number(e.niederschlag_mm)))
      setMond(e?.mond_phase ?? '')
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [date])

  async function save() {
    const filled = Object.entries(counts).filter(([, v]) => v.trim() !== '')
    await upsertRow('daily_farm_log', {
      id: existing?.id ?? crypto.randomUUID(),
      entry_date: date,
      ...Object.fromEntries(ANIMAL_CATEGORIES.map((c) => [`laufhof_${c}`, laufhof[c] ?? null])),
      wetter_code: wetter.trim() || null,
      niederschlag_mm: regen.trim() ? Number(regen.replace(',', '.')) : null,
      mond_phase: mond.trim() || null,
      animal_counts: filled.length ? JSON.stringify(Object.fromEntries(filled.map(([k, v]) => [k, Number(v)]))) : null,
      notes: notes.trim() || null,
    })
    onClose()
  }

  return (
    <Modal title={`Tagesmeldung · ${fmtDate(date)}`} onClose={onClose} onSubmit={() => void save()}>
      {loading ? (
        <p className="py-4 text-center text-gray-500">Lädt…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <span className="mb-1 block font-medium text-gray-700">Laufhof / Auslauf</span>
            <div className="space-y-1">
              {ANIMAL_CATEGORIES.map((c) => {
                const ausn = ausnahmenAm(getAusnahmen(), date, c)
                return (
                  <div key={c} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-gray-700">{ANIMAL_CATEGORY_LABEL[c]}</span>
                    <span className="flex overflow-hidden rounded border border-gray-300 text-xs" role="radiogroup" aria-label={`Laufhof ${ANIMAL_CATEGORY_LABEL[c]}`}>
                      {([
                        [null, 'auto'],
                        ['L', 'L'],
                        ['0', '0'],
                      ] as const).map(([w, t]) => (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={(laufhof[c] ?? null) === w}
                          onClick={() => setLaufhof((s) => ({ ...s, [c]: w }))}
                          className={`px-2.5 py-1 ${(laufhof[c] ?? null) === w ? 'bg-brand-700 text-white' : 'bg-white text-gray-700'}`}
                        >
                          {t}
                        </button>
                      ))}
                    </span>
                    {ausn.length > 0 && <span className="text-xs text-amber-700">! {ausn.map(ausnahmeText).join('; ')}</span>}
                  </div>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-gray-500">auto = X, wenn die Kategorie an diesem Tag auf einer Weide ist. Ausnahmen über die Laufhof-Zeile im Raster.</p>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Wetter</span>
            <input className="inp w-full" placeholder="z.B. sonnig, bewölkt, Regen" value={wetter} onChange={(e) => setWetter(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="mb-1 block font-medium text-gray-700">Niederschlag (mm)</span>
              <input
                className="inp w-full"
                inputMode="decimal"
                value={regen}
                placeholder={regenAuto != null ? `${fmtRegen(regenAuto)} (automatisch)` : undefined}
                aria-describedby={regenBis ? 'regen-auto' : undefined}
                onChange={(e) => setRegen(e.target.value)}
              />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block font-medium text-gray-700">Mond</span>
              <input className="inp w-full" placeholder="z.B. zunehmend" value={mond} onChange={(e) => setMond(e.target.value)} />
            </label>
          </div>
          {regenBis && (
            <p id="regen-auto" className="-mt-1 text-xs text-gray-600" data-testid="regen-auto">
              {regenAuto != null
                ? `Automatisch: ${fmtRegen(regenAuto)} mm (${REGEN_QUELLE}). `
                : `Noch kein automatischer Wert für diesen Tag (${REGEN_QUELLE}, bis ${fmtDate(regenBis)}). `}
              {regenAuto != null && (regen.trim() ? 'Dein Eintrag geht vor; leer lassen für den automatischen Wert.' : 'Ein Eintrag hier geht vor.')}
            </p>
          )}
          <div>
            <span className="mb-1 block font-medium text-gray-700">Anzahl Tiere (optional)</span>
            <div className="grid grid-cols-3 gap-2">
              {ANIMAL_CATEGORIES.map((c) => (
                <label key={c} className="text-xs text-gray-600">
                  {ANIMAL_CATEGORY_LABEL[c]}
                  <input
                    className="inp mt-0.5 w-full"
                    inputMode="numeric"
                    value={counts[c] ?? ''}
                    onChange={(e) => setCounts((s) => ({ ...s, [c]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Notizen</span>
            <input className="inp w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" className="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" onClick={() => void save()}>
              Speichern
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
