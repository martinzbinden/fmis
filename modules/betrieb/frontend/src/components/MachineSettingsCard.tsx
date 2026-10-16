import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '../hooks/useQuery'
import {
  formatSetting,
  kgPerHaFromSample,
  loadSettings,
  machineDefs,
  rateDef,
  saveSetting,
  suggestSlide,
  type MachineSetting,
  type SettingDef,
} from '../lib/machineSettings'
import type { Machine } from '../types'

const parse = (v: string) => {
  const t = v.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function groups(defs: SettingDef[]): [string, SettingDef[]][] {
  const out = new Map<string, SettingDef[]>()
  for (const d of defs) out.set(d.part ?? '', [...(out.get(d.part ?? '') ?? []), d])
  return [...out]
}

/** Einstellungen eines Geräts erfassen (vorbelegt mit den zuletzt
 * protokollierten Werten) und das Protokoll zeigen. Im Tracking mit der
 * laufenden Spur verknüpft. */
export default function MachineSettingsCard({
  machine,
  trackId,
  canWrite,
  historyLimit = 5,
  large = false,
}: {
  machine: Machine
  trackId: string | null
  canWrite: boolean
  historyLimit?: number
  /** grössere Felder (Tracking auf dem Traktor) */
  large?: boolean
}) {
  const defs = useMemo(() => machineDefs(machine), [machine])
  const { data: log, refresh } = useQuery((pg) => loadSettings(pg, machine.id), [machine.id])
  const forTrack = trackId ? (log ?? []).find((s) => s.track_id === trackId) ?? null : null
  const last = forTrack ?? log?.[0] ?? null
  const [values, setValues] = useState<Record<string, string>>({})
  const [crop, setCrop] = useState('')
  const [measured, setMeasured] = useState('')
  const [target, setTarget] = useState('')
  const [sampleG, setSampleG] = useState('')
  const [sampleM2, setSampleM2] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [prefilled, setPrefilled] = useState<string | null>(null)

  // Einmal je Maschine/Spur mit dem letzten Stand vorbelegen
  useEffect(() => {
    if (!log) return
    const key = `${machine.id}:${trackId ?? ''}`
    if (prefilled === key) return
    setPrefilled(key)
    setValues(Object.fromEntries(Object.entries(last?.settings ?? {}).map(([k, v]) => [k, String(v)])))
    setCrop(last?.crop ?? '')
    setMeasured(forTrack?.measured_kg_ha != null ? String(forTrack.measured_kg_ha) : '')
    setNotes(forTrack?.notes ?? '')
  }, [log, machine.id, trackId, prefilled, last, forTrack])

  if (!defs.length) {
    return (
      <p className="text-xs text-gray-500">
        Für dieses Gerät sind keine Einstellgrössen erfasst — unter Maschinen → {machine.name} → Bearbeiten → «Einstellgrössen» festlegen.
      </p>
    )
  }

  async function save() {
    setSaving(true)
    try {
      const settings: Record<string, number> = {}
      for (const d of defs) {
        const v = parse(values[d.key] ?? '')
        if (v != null) settings[d.key] = v
      }
      // Im Tracking: eine Zeile je Spur, die beim erneuten Speichern
      // nachgeführt wird; sonst je Speichern ein neuer Eintrag.
      await saveSetting({
        id: forTrack?.id,
        machine_id: machine.id,
        track_id: trackId,
        set_at: forTrack?.set_at,
        settings,
        crop: crop.trim() || null,
        measured_kg_ha: parse(measured),
        notes: notes.trim() || null,
      })
      setSavedAt(new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }))
      refresh()
    } finally {
      setSaving(false)
    }
  }

  const input = large ? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base' : 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
  const sown = /saat|sä/i.test(`${machine.kind} ${machine.name}`)
  const slideDef = sown ? rateDef(defs) : null
  const suggestion = slideDef ? suggestSlide(log ?? [], slideDef.key, crop, parse(target) ?? 0) : null
  const sampleKgHa = kgPerHaFromSample(parse(sampleG) ?? 0, parse(sampleM2) ?? 0)
  const cropField = (
    <label className="block text-xs text-gray-600">
      Kultur / Sorte
      <input className={input} disabled={!canWrite} value={crop} onChange={(e) => setCrop(e.target.value)} placeholder={sown ? 'z.B. Winterweizen Wiwa' : ''} />
    </label>
  )
  return (
    <div className="space-y-3">
      {slideDef && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {cropField}
            <label className="block text-xs text-gray-600">
              Ziel-Saatmenge (kg/ha)
              <input className={input} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
          </div>
          {parse(target) != null && crop.trim() !== '' && (
            <div className={`rounded-lg p-2 text-xs ${suggestion ? 'bg-green-50 text-green-900' : 'bg-gray-50 text-gray-600'}`}>
              {suggestion ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {slideDef.label} ca. {suggestion.value.toLocaleString('de-CH')} {slideDef.unit}
                    </span>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, [slideDef.key]: String(suggestion.value) }))}
                        className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white"
                      >
                        übernehmen
                      </button>
                    )}
                  </div>
                  <div>
                    aus {suggestion.points.length} {suggestion.points.length === 1 ? 'Abdrehprobe' : 'Abdrehproben'}{' '}
                    {suggestion.basis === 'sorte' ? 'dieser Sorte' : 'derselben Kultur (andere Sorte — TKG/Korngrösse können abweichen)'}:{' '}
                    {suggestion.points.map((p) => `${p.slide} ${slideDef.unit} → ${p.kgHa} kg/ha`).join(', ')}
                  </div>
                  <div className="mt-1 font-medium">
                    {suggestion.extrapolated || suggestion.points.length === 1 || suggestion.basis === 'kultur'
                      ? 'Startwert — mit Abdrehprobe kontrollieren und Ergebnis unten eintragen.'
                      : 'Liegt zwischen geprüften Stellungen. Kontrolle mit Abdrehprobe empfohlen.'}
                  </div>
                </>
              ) : (
                <>Noch keine Abdrehprobe für «{crop.trim()}» — Schieber schätzen, abdrehen und das Ergebnis unten eintragen. Ab der ersten Probe gibt es hier einen Vorschlag.</>
              )}
            </div>
          )}
        </div>
      )}
      {groups(defs).map(([part, list]) => (
        <div key={part}>
          {part && <div className="mb-1 text-xs font-semibold text-gray-600">{part}</div>}
          <div className="grid grid-cols-2 gap-2">
            {list.map((d) => (
              <label key={d.key} className="block text-xs text-gray-600">
                {d.label}
                {d.unit ? ` (${d.unit})` : ''}
                <input
                  className={input}
                  inputMode="decimal"
                  disabled={!canWrite}
                  value={values[d.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [d.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        {!slideDef && cropField}
        {sown && (
          <label className="block text-xs text-gray-600">
            Abdrehprobe ergab (kg/ha)
            <input className={input} inputMode="decimal" disabled={!canWrite} value={measured} onChange={(e) => setMeasured(e.target.value)} />
          </label>
        )}
      </div>
      {sown && canWrite && (
        <div className="flex flex-wrap items-end gap-2 text-xs text-gray-600">
          <span className="pb-2">Rechner:</span>
          <label className="block w-20">
            Gramm
            <input className={input} inputMode="decimal" value={sampleG} onChange={(e) => setSampleG(e.target.value)} />
          </label>
          <label className="block w-20">
            auf m²
            <input className={input} inputMode="decimal" value={sampleM2} onChange={(e) => setSampleM2(e.target.value)} />
          </label>
          {sampleKgHa != null && (
            <button type="button" onClick={() => setMeasured(String(sampleKgHa))} className="mb-1 rounded border border-gray-300 px-2 py-1 text-gray-800">
              = {sampleKgHa.toLocaleString('de-CH')} kg/ha übernehmen
            </button>
          )}
        </div>
      )}
      <label className="block text-xs text-gray-600">
        Bemerkung
        <input className={input} disabled={!canWrite} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {canWrite && (
        <div className="flex items-center gap-3">
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {forTrack ? 'Einstellung aktualisieren' : 'Einstellung speichern'}
          </button>
          {savedAt && <span className="text-xs text-green-700">gespeichert {savedAt}</span>}
        </div>
      )}
      <History log={(log ?? []).slice(0, historyLimit)} defs={defs} />
    </div>
  )
}

function History({ log, defs }: { log: MachineSetting[]; defs: SettingDef[] }) {
  if (!log.length) return null
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-gray-600">Bisherige Einstellungen</div>
      <ul className="divide-y rounded-lg border text-xs">
        {log.map((s) => (
          <li key={s.id} className="p-2">
            <div className="font-medium text-gray-800">
              {new Date(s.set_at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}
              {s.crop ? ` · ${s.crop}` : ''}
              {s.measured_kg_ha != null ? ` · Abdrehprobe ${s.measured_kg_ha} kg/ha` : ''}
            </div>
            <div className="text-gray-600">{formatSetting(defs, s.settings) || '–'}</div>
            {s.notes && <div className="text-gray-500">{s.notes}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
