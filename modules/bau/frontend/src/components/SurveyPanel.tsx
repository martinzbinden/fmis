import { useEffect, useMemo, useState } from 'react'
import AsyncButton from '@fmis/core/AsyncButton'
import NumberInput from '@fmis/core/NumberInput'
import { fmtLv95, wgs84ToLv95 } from '@fmis/core/lv95'
import { notify, notifySuccess } from '@fmis/core/toast'
import { CATEGORIES } from '../lib/categories'
import { addSurveyPoint, adoptSurvey, removeSurveyPoint } from '../lib/data'
import { pointLabel } from '../lib/csv'
import { parseGeometry } from '../lib/geometry'
import { ACCURACY_WARN_M, accuracyClass } from '../lib/survey'
import type { Fix } from '../lib/useGeolocation'
import type { BauFeature, SurveyPoint } from '../types'

const CLASS_STYLE = {
  gut: 'bg-green-600 text-white',
  ok: 'bg-amber-500 text-white',
  schlecht: 'bg-red-600 text-white',
  unbekannt: 'bg-gray-500 text-white',
} as const

/** Einmessen vor Ort: GPS live mit Genauigkeit, «Punkt setzen», Linie aus Messpunkten übernehmen. */
export default function SurveyPanel({
  projectId,
  features,
  points,
  targetId,
  onTarget,
  fix,
  gpsError,
  canWrite,
}: {
  projectId: string
  features: BauFeature[]
  points: SurveyPoint[]
  targetId: string | null
  onTarget: (id: string | null) => void
  fix: Fix | null
  gpsError: string | null
  canWrite: boolean
}) {
  const [depth, setDepth] = useState('')
  const [note, setNote] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const target = features.find((f) => f.id === targetId) ?? null
  const mine = useMemo(() => points.filter((p) => p.feature_id === targetId).sort((a, b) => a.seq - b.seq), [points, targetId])
  const cls = accuracyClass(fix?.accuracy)
  const age = fix ? Math.round((now - fix.timestamp) / 1000) : null
  const stale = age != null && age > 10
  const lv = fix ? wgs84ToLv95([fix.lng, fix.lat]) : null
  const isPoint = target ? parseGeometry(target.geometry)?.type === 'Point' : false

  async function setPoint() {
    if (!fix) return
    await addSurveyPoint(
      projectId,
      targetId,
      {
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy,
        altitude_m: fix.altitude,
        depth_cm: depth.trim() ? Number(depth.replace(',', '.')) : null,
        note: note.trim() || null,
      },
      points,
    )
    const no = Math.max(0, ...points.map((p) => p.point_no)) + 1
    const acc = fix.accuracy != null ? ` (±${fix.accuracy.toFixed(1)} m)` : ''
    if (fix.accuracy != null && fix.accuracy > ACCURACY_WARN_M) notify('info', `${pointLabel(no)} gesetzt${acc} — ungenau, besser im Freien wiederholen.`, 5000)
    else notifySuccess(`${pointLabel(no)} gesetzt${acc}`)
    setNote('')
  }

  async function adopt() {
    if (!target) return
    const what = isPoint ? 'Position' : 'Geometrie'
    if (!confirm(`${what} von «${target.label ?? CATEGORIES[target.category].label}» durch ${isPoint ? 'den letzten' : mine.length} Messpunkt${isPoint || mine.length === 1 ? '' : 'e'} ersetzen?\nDie bisherige Planlinie bleibt zum Vergleich erhalten, der Status wird «eingemessen».`)) return
    const ok = await adoptSurvey(target, points)
    if (ok) notifySuccess('Eingemessen übernommen.')
    else notify('error', 'Für eine Linie braucht es mindestens 2 Messpunkte.')
  }

  return (
    <div className="space-y-3">
      {/* GPS-Anzeige */}
      <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-2">
        <div className={`grid min-h-12 min-w-16 place-items-center rounded-lg px-2 text-center text-lg font-bold ${CLASS_STYLE[stale ? 'unbekannt' : cls]}`} aria-live="polite">
          {fix?.accuracy != null ? `±${fix.accuracy.toFixed(1)} m` : '–'}
        </div>
        <div className="min-w-0 flex-1 text-xs text-gray-700">
          {gpsError ? (
            <span className="text-red-700">{gpsError}</span>
          ) : !fix ? (
            'Warte auf GPS …'
          ) : (
            <>
              <div className="font-mono text-[12px] text-gray-900">
                E {fmtLv95(lv![0], 1)} · N {fmtLv95(lv![1], 1)}
              </div>
              <div>
                {fix.altitude != null ? `Höhe ${fix.altitude.toFixed(1)} m (GPS, ungenau) · ` : ''}
                {stale ? <span className="text-red-700">letzter Fix vor {age} s</span> : `vor ${age} s`}
              </div>
            </>
          )}
        </div>
      </div>
      {fix?.accuracy != null && fix.accuracy > ACCURACY_WARN_M && (
        <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">
          Genauigkeit schlechter als {ACCURACY_WARN_M} m. Handy-GPS liegt meist bei 3–5 m — für Geometer-taugliche Messungen braucht es einen RTK-Empfänger. Der Punkt wird trotzdem mit seiner Genauigkeit gespeichert.
        </p>
      )}

      <label className="block text-xs font-medium text-gray-700">
        Messpunkte gehören zu
        <select className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base" value={targetId ?? ''} onChange={(e) => onTarget(e.target.value || null)}>
          <option value="">ohne Objekt (freie Punkte)</option>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {CATEGORIES[f.category].icon} {f.label ?? CATEGORIES[f.category].label}
            </option>
          ))}
        </select>
      </label>

      {canWrite && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-gray-700">
              Tiefe (cm)
              <NumberInput className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base" value={depth} onChange={(e) => setDepth(e.target.value)} />
            </label>
            <label className="col-span-2 block text-xs font-medium text-gray-700">
              Notiz
              <input className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base" value={note} onChange={(e) => setNote(e.target.value)} placeholder="z.B. Bogen, Muffe" />
            </label>
          </div>
          <AsyncButton
            onClick={setPoint}
            disabled={!fix}
            busyLabel="Speichert…"
            doneLabel="✓ gesetzt"
            className={`min-h-14 w-full rounded-xl text-lg font-bold text-white shadow disabled:opacity-40 ${cls === 'schlecht' ? 'bg-red-600' : 'bg-brand-600'}`}
          >
            📍 Punkt setzen{fix?.accuracy != null ? ` (±${fix.accuracy.toFixed(1)} m)` : ''}
          </AsyncButton>
        </>
      )}

      {target && canWrite && (
        <button
          type="button"
          disabled={mine.length < (isPoint ? 1 : 2)}
          onClick={() => void adopt()}
          className="min-h-12 w-full rounded-lg border border-brand-600 px-3 text-sm font-semibold text-brand-800 disabled:opacity-40"
        >
          {isPoint ? 'Letzten Messpunkt als Position übernehmen' : 'Linie aus Messpunkten übernehmen'} ({mine.length})
        </button>
      )}

      <div>
        <div className="mb-1 text-xs font-semibold text-gray-700">Messpunkte {target ? `von «${target.label ?? CATEGORIES[target.category].label}»` : '(ohne Objekt)'}</div>
        {mine.length === 0 ? (
          <p className="text-xs text-gray-600">Noch keine.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {mine.map((p) => (
              <li key={p.id} className="flex items-center gap-2 p-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${CLASS_STYLE[accuracyClass(p.accuracy_m)]}`}>{pointLabel(p.point_no)}</span>
                <span className="min-w-0 flex-1 text-xs text-gray-700">
                  {p.accuracy_m != null ? `±${p.accuracy_m.toFixed(1)} m` : 'Genauigkeit ?'}
                  {p.depth_cm != null ? ` · ${p.depth_cm} cm tief` : ''}
                  {p.altitude_m != null ? ` · H ${p.altitude_m.toFixed(1)}` : ''}
                  {' · '}
                  {new Date(p.measured_at).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                {canWrite && (
                  <button
                    type="button"
                    aria-label={`${pointLabel(p.point_no)} löschen`}
                    className="grid min-h-12 min-w-12 place-items-center text-lg text-gray-500"
                    onClick={() => confirm(`${pointLabel(p.point_no)} löschen?`) && void removeSurveyPoint(p)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
