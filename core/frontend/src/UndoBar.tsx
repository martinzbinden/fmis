import { useEffect, useState } from 'react'
import Modal from './Modal'
import { describeRejected } from './outbox'
import { syncModuleNow } from './sync'
import { notifyError, notifySuccess, errorText } from './toast'
import { describeStep, markNotUndone, redoStep, undoStep, useUndoSteps, type UndoStep } from './undo'

/** Wie lange die Leiste nach dem Speichern sichtbar bleibt (mit Handschuhen
 * im Stall braucht man mehr als ein paar Sekunden). */
const SHOW_MS = 30_000

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
}

async function runUndo(step: UndoStep): Promise<void> {
  try {
    await undoStep(step.id)
    // gleich senden: lehnt der Server ab (Korrekturfrist), kommt der Eintrag zurück
    const keys = new Set(step.changes.map((c) => `${c.table}|${c.id}`))
    const rejected = (await Promise.all(step.parts.map((p) => syncModuleNow(p.source)))).flat().filter((r) => keys.has(`${r.table}|${r.id}`))
    if (rejected.length > 0) {
      markNotUndone(step.id)
      notifyError(`Nicht zurückgenommen: ${describeRejected(rejected)}`)
      return
    }
    notifySuccess(`Zurückgenommen – ${describeStep(step)}`)
  } catch (e) {
    notifyError(`Rückgängig fehlgeschlagen: ${errorText(e)}`)
  }
}

/** Macht das Zurücknehmen rückgängig («Wiederholen»): der Schritt gilt wieder. */
async function runRedo(step: UndoStep): Promise<void> {
  try {
    await redoStep(step.id)
    await Promise.all(step.parts.map((p) => syncModuleNow(p.source)))
    notifySuccess(`Wieder angewendet – ${describeStep(step)}`)
  } catch (e) {
    notifyError(`Wiederholen fehlgeschlagen: ${errorText(e)}`)
  }
}

/** Leiste über dem Menü: nach jedem Speichern kurz «Rückgängig», dazu die Liste
 * aller Schritte dieser Sitzung (core/undo.ts). */
export default function UndoBar() {
  const steps = useUndoSteps()
  const latest = [...steps].reverse().find((s) => !s.undone)
  const [visibleFor, setVisibleFor] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // neu anzeigen, wenn ein Schritt dazukommt oder wächst
  const latestKey = latest ? `${latest.id}:${latest.changes.length}` : null

  useEffect(() => {
    if (!latestKey) return
    setVisibleFor(latestKey)
    const t = setTimeout(() => setVisibleFor((v) => (v === latestKey ? null : v)), SHOW_MS)
    return () => clearTimeout(t)
  }, [latestKey])

  const open = steps.filter((s) => !s.undone)
  const show = latest && visibleFor === latestKey

  return (
    <>
      {!show && open.length > 0 && (
        // dezent, solange es in dieser Sitzung etwas zurückzunehmen gibt
        <div className="pointer-events-none flex justify-end px-2 pb-1">
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="pointer-events-auto min-h-11 rounded-full border border-gray-400 bg-white/95 px-4 text-sm font-medium text-gray-900 shadow"
            aria-label={`Rückgängig: ${open.length} Schritte in dieser Sitzung`}
          >
            ↶ Rückgängig ({open.length})
          </button>
        </div>
      )}
      {show && (
        <div className="border-t border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white" role="status">
          <div className="mx-auto flex max-w-lg items-center gap-2">
            <span className="min-w-0 flex-1 truncate">✓ {describeStep(latest)}</span>
            {open.length > 1 && (
              <button type="button" onClick={() => setListOpen(true)} className="min-h-11 shrink-0 px-2 text-xs text-gray-200 underline">
                alle {open.length}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void runUndo(latest).finally(() => setBusy(false))
              }}
              className="min-h-11 shrink-0 rounded-lg bg-white px-3 font-semibold text-gray-900 disabled:opacity-50"
            >
              ↶ Rückgängig
            </button>
          </div>
        </div>
      )}
      {listOpen && (
        <Modal title="Rückgängig (diese Sitzung)" onClose={() => setListOpen(false)}>
          <SessionUndoList />
        </Modal>
      )}
    </>
  )
}

/** Alle Schritte dieser Sitzung, neueste zuerst — auch auf den Verlaufsseiten. */
export function SessionUndoList({ source, title }: { source?: string; title?: string }) {
  const steps = useUndoSteps().filter((s) => !source || s.source === source)
  const [busyId, setBusyId] = useState<number | null>(null)
  // Sicherheitsabfrage: erst «Rückgängig», dann «Ja, zurücknehmen»
  const [confirmId, setConfirmId] = useState<number | null>(null)
  // mit Titel (Verlaufsseiten) ganz weglassen, solange es nichts gibt
  if (steps.length === 0) return title ? null : <p className="text-sm text-gray-600">In dieser Sitzung noch nichts gespeichert.</p>
  const run = (s: UndoStep, fn: (s: UndoStep) => Promise<void>) => {
    setBusyId(s.id)
    setConfirmId(null)
    void fn(s).finally(() => setBusyId(null))
  }
  return (
    <div className="space-y-2">
      {title && <h2 className="text-sm font-semibold text-gray-700">{title}</h2>}
      <ul className="divide-y rounded-lg border border-gray-200 bg-white">
        {[...steps].reverse().map((s) => (
          <li key={s.id} className={`px-3 py-2 text-sm ${s.undone ? 'text-gray-500' : 'text-gray-900'}`}>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 tabular-nums text-gray-600">{timeOf(s.at)}</span>
              <span className={`min-w-0 flex-1 ${s.undone ? 'line-through' : ''}`}>{describeStep(s)}</span>
              {s.undone ? (
                s.redo ? (
                  <button type="button" disabled={busyId != null} onClick={() => run(s, runRedo)} title="Das Zurücknehmen rückgängig machen" className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-50">
                    {busyId === s.id ? '…' : '↷ Wiederholen'}
                  </button>
                ) : (
                  <span className="shrink-0 text-xs">zurückgenommen</span>
                )
              ) : (
                confirmId !== s.id && (
                  <button type="button" disabled={busyId != null} onClick={() => setConfirmId(s.id)} className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-sm disabled:opacity-50">
                    {busyId === s.id ? '…' : '↶ Rückgängig'}
                  </button>
                )
              )}
            </div>
            {confirmId === s.id && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-amber-900" role="alert">
                <span className="min-w-0 flex-1 text-xs">Wirklich zurücknehmen? «{describeStep(s)}» wird rückgängig gemacht.</span>
                <button type="button" onClick={() => run(s, runUndo)} className="min-h-11 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white">
                  Ja, zurücknehmen
                </button>
                <button type="button" onClick={() => setConfirmId(null)} className="min-h-11 rounded-lg border border-amber-700 px-3 text-sm">
                  Abbrechen
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-600">Nach dem Neuladen der App ist diese Liste leer. Ein zurückgenommener Schritt lässt sich bis dahin mit «Wiederholen» wieder anwenden. Ältere Änderungen kann ein Admin im Verlauf (📜) zurücknehmen.</p>
    </div>
  )
}
