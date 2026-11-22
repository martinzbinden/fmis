import { useEffect, useState } from 'react'
import Modal from './Modal'
// mit Sync: wird auch von Seiten anderer Module aufgerufen (Stall, Tierseite)
import { getSyncedDb as getDb } from '../db/access'
import { addDaysIso, todayIso } from '../lib/format'
import { createFollowUp, FOLLOW_UP_DAYS, FOLLOW_UP_TITLES, type FollowUpOrigin } from '../lib/workTasks'

const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'

/** Pendenz (Folgearbeit) aus einem Foto, einem Journaleintrag oder einer erledigten Arbeit: was, bis wann, wer.
 * Erscheint im Arbeitsplan am Fälligkeitstag, mit denselben Zielen und den Fotos der Herkunft. */
export default function FollowUpDialog({ origin, onClose, onSaved }: { origin: FollowUpOrigin; onClose: () => void; onSaved?: (due: string) => void }) {
  // direkt aus der Ablage des Moduls Betrieb: der Dialog öffnet sich auch auf Seiten anderer Module (Stalljournal)
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    void getDb()
      .then((pg) => pg.query<{ id: string; name: string }>('select id, name from duty_people where deleted_at is null and active order by sort_order, name'))
      .then((r) => setPeople(r.rows))
      .catch(() => setPeople([]))
  }, [])
  const suggestions = FOLLOW_UP_TITLES[origin.area]
  const [title, setTitle] = useState(`${suggestions[0]}: ${origin.title}`)
  const [due, setDue] = useState(addDaysIso(todayIso(), 7))
  const [person, setPerson] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await createFollowUp(origin, { title: title.trim(), due, personId: person || null, notes: notes.trim() || null })
      onSaved?.(due)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm ${on ? 'border-brand-700 bg-brand-50 font-semibold text-brand-900' : 'border-gray-300 text-gray-700'}`
  return (
    <Modal title="Pendenz erfassen" onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Aus «{origin.title}»{origin.targets.length ? ` · ${origin.targets.map((t) => t.label).join(', ')}` : ''}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" className={chip(title.startsWith(`${s}:`))} onClick={() => setTitle(`${s}: ${origin.title}`)}>
              {s}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-gray-600">Was</span>
          <input className={`${field} w-full`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div>
          <span className="text-gray-600">Fällig</span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {FOLLOW_UP_DAYS.map((d) => {
              const iso = addDaysIso(todayIso(), d)
              return (
                <button key={d} type="button" className={chip(due === iso)} onClick={() => setDue(iso)}>
                  {d === 7 ? '1 Woche' : d === 14 ? '2 Wochen' : d === 30 ? '1 Monat' : `${d} Tage`}
                </button>
              )
            })}
            <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig am" />
          </div>
        </div>
        <label className="block">
          <span className="text-gray-600">Wer</span>
          <select className={`${field} w-full`} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">— offen —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-gray-600">Notiz</span>
          <textarea className={`${field} w-full`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="button" disabled={busy || !title.trim()} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
          Pendenz speichern
        </button>
      </div>
    </Modal>
  )
}
