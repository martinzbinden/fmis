// Gruppenwechsel für ein Einzeltier (Tier-Info): Zielgruppe wählen, Datum, bei Melkgruppe → andere Gruppe auf Wunsch
// trockenstellen. Schreibt wie der Entwurf auf den Karten (pages/Board.tsx, ConfirmDraft) über lib/herds des Moduls Tiere.

import { useEffect, useMemo, useState } from 'react'
import { animalProvider, refreshHerdData, type AnimalRef } from '@fmis/core/animals'
import { errorText, notifyError } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { loadHerdData, memberAt, moveAnimals, removeMembers, type HerdData } from '@fmis/tiere/lib/herds'
import { localTodayIso } from '../lib/format'

export default function GroupChangePicker({ moduleKey, animalId, sheep, onDone }: { moduleKey: string; animalId: string; sheep: boolean; onDone: (msg: string) => void }) {
  const [herd, setHerd] = useState<HerdData | null>(null)
  const [ref, setRef] = useState<AnimalRef | null>(null)
  const [to, setTo] = useState<string>('')
  const [date, setDate] = useState(localTodayIso())
  const [dryOff, setDryOff] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void refreshHerdData()
      .catch(() => false)
      .then(() => Promise.all([loadHerdData(), animalProvider(moduleKey)?.listAnimals() ?? Promise.resolve([])]))
      .then(([h, refs]) => {
        if (!live) return
        setHerd(h)
        setRef(refs.find((r) => r.id === animalId) ?? null)
      })
      .catch((e: unknown) => live && notifyError(errorText(e)))
    return () => {
      live = false
    }
  }, [moduleKey, animalId])

  const species = sheep ? 'schafe' : 'rinder'
  const groups = useMemo(
    () => (herd?.groups ?? []).filter((g) => g.active && g.species === species).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de')),
    [herd, species],
  )
  const member = herd ? memberAt(herd, animalId, date) : undefined
  const current = member ? (herd?.groups.find((g) => g.id === member.group_id) ?? null) : null
  const target = to === 'none' ? null : (groups.find((g) => g.id === to) ?? null)
  const dryable = !!current?.milking && !!target && !target.milking

  async function run() {
    if (!herd || !to) return
    setBusy(true)
    try {
      const name = target?.name ?? 'Ohne Gruppe'
      await undoAction(`Gruppenwechsel nach «${name}»`, async () => {
        if (!target) {
          const ids = herd.members.filter((m) => m.animal_id === animalId && (m.to_date == null || m.to_date >= date)).map((m) => m.id)
          await removeMembers(herd, ids, date)
          return
        }
        if (!ref) throw new Error('Tier nicht gefunden')
        await moveAnimals(herd, { toGroup: target, fromGroup: null, date, animals: [ref], counts: {}, dryOff: dryable && dryOff })
      })
      onDone(target ? `Gezügelt nach «${name}»` : 'Aus der Gruppe genommen')
    } catch (e) {
      notifyError(errorText(e))
      setBusy(false)
    }
  }

  if (!herd) return <p className="rounded-lg bg-white p-3 text-sm text-gray-500 shadow-sm">Lädt…</p>
  return (
    <section className="space-y-2 rounded-lg border-2 border-brand-700 bg-white p-3 text-sm shadow-sm" aria-label="Gruppe wechseln">
      <p className="text-gray-700">
        Jetzt: <span className="font-semibold text-gray-900">{current?.name ?? 'ohne Gruppe'}</span>
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {groups
          .filter((g) => g.id !== current?.id)
          .map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={to === g.id}
              onClick={() => setTo(g.id)}
              className={`min-h-11 rounded-lg border-2 px-2 text-left font-medium ${to === g.id ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
            >
              {g.name}
            </button>
          ))}
        {current && (
          <button
            type="button"
            aria-pressed={to === 'none'}
            onClick={() => setTo('none')}
            className={`min-h-11 rounded-lg border-2 border-dashed px-2 text-left ${to === 'none' ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
          >
            Ohne Gruppe
          </button>
        )}
      </div>
      {groups.length === 0 && <p className="text-gray-600">Keine Tiergruppen angelegt (Modul Tiere → Gruppen).</p>}
      <label className="flex items-center justify-between gap-2 font-medium text-gray-800">
        ab
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="min-h-11 rounded-lg border-2 border-gray-400 px-2 text-base" />
      </label>
      {dryable && (
        <label className="flex items-center gap-2 text-gray-800">
          <input type="checkbox" checked={dryOff} onChange={(e) => setDryOff(e.target.checked)} className="h-5 w-5" />
          trockenstellen (aus der Melkgruppe)
        </label>
      )}
      <button type="button" disabled={!to || busy} onClick={() => void run()} className="min-h-12 w-full rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
        {busy ? 'Speichert…' : to ? `Nach «${target?.name ?? 'Ohne Gruppe'}» wechseln` : 'Gruppe wählen'}
      </button>
    </section>
  )
}
