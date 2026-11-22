import { useState } from 'react'
import { checkHandover, closeHandover, uncheckHandover, type DutyOccasion, type HandoverCheck, type HandoverItem } from '../lib/handover'

const time = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })

/** Übergabe-Punkte eines Dienstes: abhaken (mit kurzer Bemerkung), zurücknehmen, wiederkehrende beenden. */
export default function HandoverList({ rows, occasion, people, canWrite = true }: { rows: { item: HandoverItem; check: HandoverCheck | null }[]; occasion: DutyOccasion; people?: Map<string, string>; canWrite?: boolean }) {
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (rows.length === 0) return null
  const who = (email: string | null) => (email ? (people?.get(email.toLowerCase()) ?? email.split('@')[0]) : '')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <ul className="divide-y rounded-lg border border-amber-300 bg-amber-50 text-sm" aria-label="Übergabe">
      {rows.map(({ item, check }) => (
        <li key={item.id} className="px-2 py-1.5">
          <div className="flex items-start gap-2">
            <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={!!check}
                disabled={!canWrite || busy}
                onChange={() => {
                  if (check) void run(() => uncheckHandover(check))
                  else {
                    setNoteFor(item.id)
                    setNote('')
                  }
                }}
                aria-label={`${item.text} erledigt`}
              />
            </label>
            <div className="min-w-0 flex-1 py-1">
              <div className={`font-medium ${check ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                {item.text}
                {item.targets.length > 0 && <span className="font-normal text-gray-700"> · {item.targets.map((t) => (t.kind === 'jungtier' ? `prov. ${t.label}` : t.label)).join(', ')}</span>}
              </div>
              <div className="text-xs text-gray-600">
                {item.recurring ? `jeder Dienst${item.until_date ? ` bis ${Number(item.until_date.slice(8, 10))}.${Number(item.until_date.slice(5, 7))}.` : ''}` : 'einmal'}
                {item.created_by ? ` · von ${who(item.created_by)}` : ''}
                {check ? ` · ✓ ${who(check.done_by)} ${time(check.done_at)}${check.note ? ` – ${check.note}` : ''}` : ''}
              </div>
              {noteFor === item.id && (
                <div className="mt-1 flex flex-wrap gap-2">
                  <input className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-2 text-base" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bemerkung (optional), z.B. 150 ml getrunken" autoFocus />
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 rounded-lg bg-green-700 px-3 font-semibold text-white"
                    onClick={() =>
                      void run(async () => {
                        await checkHandover(item, occasion, note)
                        setNoteFor(null)
                      })
                    }
                  >
                    ✓ Erledigt
                  </button>
                  <button type="button" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3" onClick={() => setNoteFor(null)}>
                    Abbrechen
                  </button>
                </div>
              )}
            </div>
            {canWrite && (item.recurring || !check) && (
              <button type="button" disabled={busy} onClick={() => void run(() => closeHandover(item))} className="min-h-11 shrink-0 rounded-lg px-2 text-xs text-gray-600 active:bg-amber-100" title={item.recurring ? 'Nicht mehr nötig: für alle weiteren Dienste beenden' : 'Punkt verwerfen'}>
                {item.recurring ? 'beenden' : 'verwerfen'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
