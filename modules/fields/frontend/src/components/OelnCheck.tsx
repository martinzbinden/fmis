import { useState } from 'react'
import { RULE_SOURCE, ruleText, type YearCheck } from '../lib/rotationRules'

const ha = (x: number) => x.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** ÖLN-Fruchtfolge je Betrieb und Jahr: Anzahl Kulturen und Höchstanteile
 * (lib/rotationRules.ts). Jahre mit geplanten Kulturen sind mitgerechnet. */
export default function OelnCheck({ farms, plannedYears }: { farms: { name: string; checks: YearCheck[] }[]; plannedYears: Set<number> }) {
  const [openYear, setOpenYear] = useState<string | null>(null)
  if (farms.every((f) => f.checks.length === 0)) return null
  return (
    <details className="rounded-lg bg-white shadow-sm" open>
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-gray-700">ÖLN-Fruchtfolge je Jahr</summary>
      <div className="space-y-3 border-t px-3 py-2">
        {farms.map((f) => (
          <div key={f.name}>
            {farms.length > 1 && <div className="mb-1 text-sm font-semibold text-gray-800">{f.name}</div>}
            <ul className="divide-y text-sm">
              {f.checks.map((c) => {
                const key = `${f.name}|${c.jahr}`
                // unter 3 ha offener Ackerfläche gelten die Regeln nicht
                const bad = c.applies ? c.shares.filter((s) => !s.ok) : []
                const ok = !c.applies || (c.culturesOk && bad.length === 0)
                const open = openYear === key
                return (
                  <li key={c.jahr}>
                    <button type="button" onClick={() => setOpenYear(open ? null : key)} className="flex min-h-11 w-full items-center gap-2 text-left" aria-expanded={open}>
                      <span className="w-14 shrink-0 font-medium text-gray-800">
                        {c.jahr}
                        {plannedYears.has(c.jahr) && <span className="block text-[10px] font-normal text-gray-500">mit Plan</span>}
                      </span>
                      <span className="min-w-0 flex-1 text-xs text-gray-600">
                        {ha(c.openHa)} ha offen · {ha(c.arableHa)} ha Acker · {c.cultures} Kulturen
                        {bad.length > 0 && <span className="block text-red-700">{bad.map((b) => `${b.rule.label} ${b.pct} % (max. ${b.rule.maxPct} %)`).join(' · ')}</span>}
                        {c.applies && !c.culturesOk && <span className="block text-red-700">weniger als 4 Kulturen</span>}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${!c.applies ? 'bg-gray-100 text-gray-600' : ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {!c.applies ? 'unter 3 ha' : ok ? 'erfüllt' : 'prüfen'}
                      </span>
                    </button>
                    {open && (
                      <div className="mb-2 space-y-1 rounded bg-gray-50 p-2 text-xs text-gray-700">
                        {c.shares.length === 0 && <div>Keine Hauptkultur mit Höchstanteil.</div>}
                        {c.shares.map((s) => (
                          <div key={s.rule.group} className="flex justify-between gap-2">
                            <span>{s.rule.label}</span>
                            <span className={s.ok || !c.applies ? 'text-gray-700' : 'font-semibold text-red-700'}>
                              {s.pct} % <span className="text-gray-400">/ max. {s.rule.maxPct} %</span>
                            </span>
                          </div>
                        ))}
                        {c.unknown.length > 0 && <div className="text-amber-800">Ohne Kulturname, keiner Gruppe zugeordnet: {c.unknown.join(', ')}</div>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <p className="text-xs text-gray-500">
          Nach {RULE_SOURCE}: ab 3 ha offener Ackerfläche mindestens 4 Kulturen (ab 10 % der Ackerfläche; Kunstwiese ab 20 % zählt
          doppelt, ab 30 % dreifach) und Höchstanteile je Hauptkultur. Wer stattdessen Anbaupausen einhält, braucht die 4 Kulturen
          nicht — die Pausen zeigt der Zeitstrahl mit ⚠ ({ruleText({ group: 'weizen_korn', label: 'z.B. Weizen und Korn', maxPct: 50, max: 1, window: 2 })}).
          Nur Hauptkulturen, ohne Zwischenfutter.
        </p>
      </div>
    </details>
  )
}
