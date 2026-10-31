import type { TagReader } from './tagReader'

const TONE = { ok: 'text-gray-900', warn: 'text-amber-900', error: 'text-red-700' } as const
const DOT = { off: 'bg-gray-400', connecting: 'bg-amber-400 animate-pulse', ready: 'bg-green-500', error: 'bg-red-500' } as const

/** Knopf «📡 Leser» (nur sichtbar, wenn ein Lesegerät aktiviert ist). Verbindungsstatus,
 * letzte Lesung und «trotzdem übernehmen» klappen erst auf, wenn der Leser ein ist. */
export default function TagReaderButton({ reader, hint }: { reader: TagReader; hint?: string }) {
  if (!reader.available) return null
  const { on, phase, message, reads, ignored } = reader
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => reader.setOn(!on)}
          aria-pressed={on}
          className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border-2 px-3 text-sm font-semibold ${
            on ? 'border-green-700 bg-green-700 text-white' : 'border-gray-400 bg-white text-gray-800'
          }`}
        >
          📡 {on ? 'Leser ein' : 'Leser'}
        </button>
        {!on && phase === 'error' && message && <span className="text-sm text-red-700">{message.text}</span>}
      </div>
      {on && (
        <div className="space-y-1.5 rounded-lg border border-green-700/40 bg-green-50 px-3 py-2 text-sm" role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[phase]}`} aria-hidden />
            <span className={`min-w-0 flex-1 font-medium ${TONE[message?.tone ?? 'ok']}`}>{message?.text ?? 'Verbinde …'}</span>
            {reads > 0 && <span className="shrink-0 tabular-nums text-xs text-gray-600">{reads} gelesen</span>}
          </div>
          {ignored && (
            <button type="button" onClick={reader.takeIgnored} className="min-h-10 rounded-lg border-2 border-amber-600 bg-white px-3 text-sm font-semibold text-amber-900">
              {ignored.read.earTag} trotzdem übernehmen
            </button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
            <label className="flex min-h-9 items-center gap-1.5">
              <input type="checkbox" checked={reader.allowDuplicates} onChange={(e) => reader.setAllowDuplicates(e.target.checked)} />
              Doppelte zulassen
            </label>
            {hint && <span>{hint}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
