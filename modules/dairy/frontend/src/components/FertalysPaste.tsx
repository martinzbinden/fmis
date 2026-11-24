// FERTALYS-Mail einfügen (Trächtigkeit, Rindvieh): Text der Mail hineinkopieren → Vorschau mit Zuordnung → speichern.

import { useState } from 'react'
import { useDb } from '@fmis/core/DbContext'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { applyFertalys, parseFertalys, parseMailDate, planFertalys, type FertalysPlan } from '../lib/fertalys'
import { fmtDate, localTodayIso } from '../lib/format'
import { RESULT_LABEL } from '../lib/pregnancy'

const TONE = { ja: 'bg-green-100 text-green-900', nein: 'bg-red-100 text-red-900', unsicher: 'bg-amber-100 text-amber-900' } as const

export default function FertalysPaste({ onDone }: { onDone: () => void }) {
  const db = useDb()
  const [text, setText] = useState('')
  const [mailDate, setMailDate] = useState(localTodayIso)
  const [plan, setPlan] = useState<FertalysPlan[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function check(t = text, d = mailDate) {
    const lines = parseFertalys(t)
    setPlan(lines.length ? await planFertalys(db, lines, d) : [])
  }
  async function save() {
    if (!plan) return
    setBusy(true)
    try {
      const n = await applyFertalys(db, plan, mailDate)
      notifySuccess(`FERTALYS: ${n} ${n === 1 ? 'Resultat' : 'Resultate'} gespeichert`)
      onDone()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const ok = plan?.filter((p) => p.animal).length ?? 0

  return (
    <section className="space-y-2 rounded-2xl border-2 border-brand-700 bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-gray-900">🧪 FERTALYS-Mail einfügen</h2>
        <button type="button" onClick={onDone} className="min-h-11 rounded-lg px-3 text-sm text-gray-700">
          Schliessen
        </button>
      </div>
      <p className="text-sm text-gray-700">Mail von cownect/Qualitas öffnen, alles markieren und kopieren, hier einfügen. Zugeordnet wird über den Namen; als Datum zählt die letzte Milchprobe der Kuh vor der Mail.</p>
      <textarea
        value={text}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          const d = parseMailDate(t, localTodayIso()) ?? mailDate
          setMailDate(d)
          void check(t, d)
        }}
        rows={6}
        placeholder={'ALBINA Trächtig\nLIMMAT Nicht trächtig'}
        aria-label="Text der FERTALYS-Mail"
        className="w-full rounded-lg border-2 border-gray-400 p-2 text-base"
      />
      <label className="flex items-center justify-between gap-2 text-sm font-medium text-gray-800">
        Datum der Mail
        <input
          type="date"
          className="min-h-11 rounded-lg border-2 border-gray-400 px-2 text-base"
          value={mailDate}
          onChange={(e) => {
            if (!e.target.value) return
            setMailDate(e.target.value)
            void check(text, e.target.value)
          }}
        />
      </label>
      {plan && plan.length === 0 && text.trim() && <p className="text-sm text-red-800">Keine Resultatzeile gefunden (erwartet z.B. «ALBINA Trächtig»).</p>}
      {plan && plan.length > 0 && (
        <ul className="divide-y rounded-lg border border-gray-200 text-sm">
          {plan.map((p, i) => (
            <li key={i} className={`flex items-center gap-2 px-2 py-1.5 ${p.animal ? '' : 'bg-red-50'}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-gray-900">{p.animal?.label ?? p.line.name}</span>
                <span className="block text-xs text-gray-600">
                  {p.animal ? `${fmtDate(p.date)} (${p.dateBasis === 'milchprobe' ? 'Milchprobe' : 'Mail'})${p.existingId ? ' · schon erfasst, wird ersetzt' : ''}` : `«${p.line.name}»: ${p.problem}`}
                </span>
              </span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${TONE[p.line.result]}`}>{RESULT_LABEL[p.line.result]}</span>
            </li>
          ))}
        </ul>
      )}
      {plan && plan.length > ok && <p className="text-xs text-red-800">Nicht zugeordnete Zeilen werden nicht gespeichert – bitte von Hand als Einzelbefund erfassen.</p>}
      <button type="button" disabled={busy || ok === 0} onClick={() => void save()} className="min-h-12 w-full rounded-xl bg-brand-700 text-lg font-bold text-white disabled:opacity-40">
        {ok > 0 ? `${ok} ${ok === 1 ? 'Resultat' : 'Resultate'} speichern` : 'Speichern'}
      </button>
    </section>
  )
}
