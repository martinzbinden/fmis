import HoldButton from './HoldButton'

export const RESUME_HOLD_MS = 1000

/** Ein schon laufender Durchgang (zuletzt auf diesem Gerät, oder wieder ausgewählt) setzt sich nie von selbst fort:
 * erst nach einer Sekunde Gedrückthalten geht die Erfassung wieder auf. So tippt man sich im Stall nicht aus Versehen
 * in einen alten Durchgang. */
export default function ResumeGate({ title, title2, info, onResume, onEnd }: { title: string; title2: string; info: string; onResume: () => void; onEnd: () => void }) {
  return (
    <div className="mx-auto max-w-lg space-y-3 p-3 pb-24">
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <section className="space-y-3 rounded-2xl border-2 border-brand-700 bg-white p-4 shadow-lg">
        <div>
          <div className="text-sm font-medium text-gray-600">Durchgang pausiert</div>
          <div className="text-lg font-semibold text-gray-900">{title2}</div>
          <div className="text-sm text-gray-700">{info}</div>
        </div>
        <HoldButton label="Fortsetzen: 1 Sekunde gedrückt halten" onDone={onResume} ms={RESUME_HOLD_MS} />
        <button type="button" onClick={onEnd} className="min-h-12 w-full rounded-xl border-2 border-gray-300 bg-white font-medium text-gray-800 active:bg-gray-50">
          Durchgang beenden
        </button>
      </section>
    </div>
  )
}
