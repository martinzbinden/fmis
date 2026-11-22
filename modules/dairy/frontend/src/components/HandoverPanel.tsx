import { useCallback, useEffect, useMemo, useState } from 'react'
// mit Sync des Moduls Betrieb: Übergaben anderer Geräte kommen auch hier an
import { getSyncedDb as getBetriebDb } from '@fmis/betrieb/db/access'
import { subscribeDataChanged } from '@fmis/betrieb/db/write'
import { slotsFor, typeLabel } from '@fmis/betrieb/lib/duty'
import { itemsFor, loadHandover, type HandoverCheck, type HandoverItem, type HandoverTarget } from '@fmis/betrieb/lib/handover'
import HandoverForm from '@fmis/betrieb/components/HandoverForm'
import HandoverList from '@fmis/betrieb/components/HandoverList'
import type { DutyType } from '@fmis/betrieb/types'
import AnimalPicker from './AnimalPicker'
import { useQuery } from '../hooks/useQuery'
import { asPickerAnimal, isProvisional, loadProvisionalYoung, offspringIdOf } from '../lib/provisional'
import type { Animal } from '../types'

/** Tierart dieses Moduls wie im Dienstplan (duty_types.animal). */
export const dutyAnimal = (sheep: boolean) => (sheep ? 'Schafe' : 'Kühe')

/** Übergabe-Checkliste im Stall: je Dienst von heute die offenen Punkte zum Abhaken, neue Punkte mit Tieren und
 * Jungtieren ohne Ohrmarke (provisorische Nummer). Daten im Modul Betrieb (lib/handover.ts). */
export default function HandoverPanel({ moduleKey, sheep, today }: { moduleKey: string; sheep: boolean; today: string }) {
  const animal = dutyAnimal(sheep)
  const [state, setState] = useState<{ types: DutyType[]; items: HandoverItem[]; checks: HandoverCheck[] } | null>(null)
  const [adding, setAdding] = useState(false)
  const load = useCallback(async () => {
    try {
      const pg = await getBetriebDb()
      const [types, h] = await Promise.all([pg.query<DutyType>('select * from duty_types where deleted_at is null and active order by start_time').then((r) => r.rows), loadHandover(pg, today)])
      setState({ types: types.map((t) => ({ ...t, duration_min: Number(t.duration_min) })), ...h })
    } catch {
      setState({ types: [], items: [], checks: [] })
    }
  }, [today])
  useEffect(() => {
    void load()
    return subscribeDataChanged(() => void load())
  }, [load])

  // Tiere und Jungtiere ohne Ohrmarke für den Wähler
  const { data: pick } = useQuery(async (pg) => {
    const [animals, young] = await Promise.all([
      pg.query<Animal>("select * from animals where deleted_at is null and status = 'aktiv' order by lauf_nr nulls last, ear_tag").then((r) => r.rows),
      loadProvisionalYoung(pg),
    ])
    return { animals, young }
  })
  const pickerAnimals = useMemo(() => (pick ? [...pick.animals, ...pick.young.map(asPickerAnimal)] : []), [pick])

  const ownTypes = (state?.types ?? []).filter((t) => t.animal === animal)
  // Dienste von heute dieser Tierart (Zeiten des Tages)
  const todaySlots = useMemo(() => {
    const seen = new Set<string>()
    return slotsFor(ownTypes, [], [today]).filter((s) => !seen.has(s.type.id) && seen.add(s.type.id))
  }, [ownTypes, today])

  const toTargets = (ids: string[]): HandoverTarget[] =>
    ids.flatMap((id): HandoverTarget[] => {
      if (isProvisional(id)) {
        const y = pick?.young.find((x) => x.offspringId === offspringIdOf(id))
        return [{ kind: 'jungtier', module: moduleKey, id: offspringIdOf(id), label: y?.nr ?? '?' }]
      }
      const a = pick?.animals.find((x) => x.id === id)
      return a ? [{ kind: 'tier', module: moduleKey, id: a.id, label: [a.lauf_nr, a.name].filter(Boolean).join(' ') || a.ear_tag }] : []
    })
  const idsOf = (ts: HandoverTarget[]) => ts.map((t) => (t.kind === 'jungtier' ? `o:${t.id}` : 'id' in t ? t.id : '')).filter(Boolean)

  if (!state) return <p className="py-4 text-center text-gray-500">Lädt…</p>
  const open = todaySlots.reduce((n, s) => n + itemsFor(state.items, state.checks, { date: today, type: s.type }).filter((r) => !r.check).length, 0)
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Was der nächste Dienst wissen oder tun muss. {open > 0 ? `${open} offen heute.` : 'Heute nichts offen.'}
      </p>
      {adding ? (
        <HandoverForm
          types={ownTypes.map((t) => ({ id: t.id, label: `${t.start_time} ${typeLabel(t)}` }))}
          animal={animal}
          renderTargets={(targets, setTargets) => (
            <div>
              <div className="mb-1 text-gray-600">Tiere (auch Jungtiere ohne Ohrmarke: Nummer der Mutter tippen)</div>
              <AnimalPicker animals={pickerAnimals} selected={idsOf(targets)} onChange={(ids) => setTargets(toTargets(ids))} multiple readerModule={moduleKey} />
            </div>
          )}
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="min-h-12 w-full rounded-xl border-2 border-dashed border-amber-400 bg-white font-semibold text-amber-900">
          ＋ Übergabe-Punkt
        </button>
      )}
      {todaySlots.length === 0 && <p className="text-sm text-gray-600">Heute keine Dienste für {animal} im Dienstplan.</p>}
      {todaySlots.map((s) => {
        const rows = itemsFor(state.items, state.checks, { date: today, type: s.type })
        return (
          <section key={s.type.id} className="space-y-1">
            <h3 className="text-sm font-semibold text-gray-800">
              {s.type.start_time} {typeLabel(s.type)}
            </h3>
            {rows.length ? <HandoverList rows={rows} occasion={{ date: today, type: s.type }} /> : <p className="text-sm text-gray-500">Nichts zu übergeben.</p>}
          </section>
        )
      })}
    </div>
  )
}

/** Anzahl offener Übergabe-Punkte heute für diese Tierart (Karte auf «Heute»). */
export function useHandoverOpen(sheep: boolean, today: string): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const pg = await getBetriebDb()
        const [types, h] = await Promise.all([pg.query<DutyType>("select * from duty_types where deleted_at is null and active and animal = $1", [dutyAnimal(sheep)]).then((r) => r.rows), loadHandover(pg, today)])
        const seen = new Set<string>()
        const slots = slotsFor(types.map((t) => ({ ...t, duration_min: Number(t.duration_min) })), [], [today]).filter((s) => !seen.has(s.type.id) && seen.add(s.type.id))
        // je Punkt einmal zählen, auch wenn er für mehrere Dienste gilt
        const open = new Set<string>()
        for (const s of slots) for (const r of itemsFor(h.items, h.checks, { date: today, type: s.type })) if (!r.check) open.add(r.item.id)
        if (live) setN(open.size)
      } catch {
        if (live) setN(0)
      }
    }
    void load()
    const off = subscribeDataChanged(() => void load())
    return () => {
      live = false
      off()
    }
  }, [sheep, today])
  return n
}
