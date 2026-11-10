import { DP_LINE_LABEL, type DpParcelEstimate } from '../lib/directPayments'

export const rp = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Beiträge einer Parzelle Zeile für Zeile (Seite Direktzahlungen und Parzellen-Details). */
export default function DpBreakdown({ p }: { p: DpParcelEstimate }) {
  return (
    <>
      {(p.offen || p.ohne) && <p>{p.offen ?? p.ohne}</p>}
      {p.lines.map((l) => (
        <div key={l.key} className="flex justify-between gap-2">
          <span>
            {DP_LINE_LABEL[l.key]} <span className="text-gray-500">({rp(l.rate)} Fr./{p.isTree ? 'Baum' : 'ha'})</span>
          </span>
          <span className="tabular-nums">{rp(l.amount)}</span>
        </div>
      ))}
      {p.lines.length > 0 && (
        <div className="flex justify-between gap-2 border-t border-gray-200 pt-1 font-semibold">
          <span>Total pro Jahr</span>
          <span className="tabular-nums">{rp(p.total)}</span>
        </div>
      )}
      {!p.isTree && !p.offen && !p.ohne && (
        <p className="text-gray-500">{p.hangPossible ? 'Hangbeitrag je nach Neigung: nur im Betriebstotal.' : 'Kein Hangbeitrag für diese Nutzung.'}</p>
      )}
    </>
  )
}
