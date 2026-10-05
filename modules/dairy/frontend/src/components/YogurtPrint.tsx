import { createPortal } from 'react-dom'
import { shortEarTag } from '@fmis/core/earTag'
import { localTodayIso } from '../lib/format'
import { CRITERION_LABEL, yogurtMix, type YogurtCow, type YogurtMix, type YogurtOptions } from '../lib/yogurtPlan'

// Druckansicht für den Melker (A4 hoch): wer in die Joghurt-Milch kommt
// (zum Abhaken), Zusammensetzung Selektion gegenüber Gesamt- und Restmilch,
// Kühe mit Absetzfrist. Wird beim Drucken allein ausgegeben (wie der
// Prüfbericht, components/PaperReport.tsx).

export const YOGURT_PRINT_CSS = `
#joghurt-print { display: none; }
.jp-paper { font-family: Helvetica, Arial, sans-serif; color: #000; font-size: 10pt; line-height: 1.3;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.jp-sheet { background: #fff; width: 210mm; min-height: 297mm; padding: 12mm; box-sizing: border-box; margin: 0 auto;
  box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.jp-paper h1 { font-size: 16pt; margin: 0 0 1mm; }
.jp-paper h2 { font-size: 11pt; margin: 7mm 0 2mm; }
.jp-sub { font-size: 9.5pt; color: #333; margin-bottom: 4mm; }
.jp-table { width: 100%; border-collapse: collapse; }
.jp-table th { text-align: left; font-size: 8.5pt; font-weight: normal; color: #fff; background: #1b4a68; padding: 1.2mm 1.5mm; }
.jp-table td { padding: 1.6mm 1.5mm; border-bottom: 0.2mm solid #999; }
.jp-table tr:nth-child(even) td { background: #eef2f5; }
.jp-table .r { text-align: right; font-variant-numeric: tabular-nums; }
.jp-table .box { width: 7mm; }
.jp-box { display: inline-block; width: 4.5mm; height: 4.5mm; border: 0.4mm solid #000; }
.jp-table tr.jp-total td { font-weight: bold; border-top: 0.5mm solid #000; background: #fff; }
.jp-cmp td.lab { font-weight: bold; }
.jp-cmp tr.sel td { background: #dbeafe !important; }
.jp-plus { color: #166534; } .jp-minus { color: #b91c1c; }
.jp-warn { border: 0.5mm solid #b91c1c; padding: 2mm 3mm; margin-top: 2mm; }
.jp-note { font-size: 8pt; color: #333; margin-top: 6mm; }
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html, body { background: #fff !important; }
  body > *:not(#joghurt-print) { display: none !important; }
  #joghurt-print { display: block; }
  .jp-sheet { box-shadow: none; margin: 0; min-height: 0; width: auto; padding: 0; }
}
`

const f1 = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (v: number | null) => (v == null ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const cells = (v: number | null) => (v == null ? '–' : `${Math.round(v).toLocaleString('de-CH')}'000`)
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

function diff(a: number | null, b: number | null, digits: number, unit: string, invert = false) {
  if (a == null || b == null) return <span>–</span>
  const d = a - b
  const good = invert ? d < 0 : d > 0
  const txt = `${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`
  return <span className={Math.abs(d) < 10 ** -digits ? '' : good ? 'jp-plus' : 'jp-minus'}>{txt}</span>
}

function MixRow({ label, mix, className }: { label: string; mix: YogurtMix; className?: string }) {
  return (
    <tr className={className}>
      <td className="lab">{label}</td>
      <td className="r">{mix.n}</td>
      <td className="r">{f1(mix.milkKg)}</td>
      <td className="r">{f2(mix.proteinPct)}</td>
      <td className="r">{f2(mix.fatPct)}</td>
      <td className="r">{cells(mix.cellCount)}</td>
    </tr>
  )
}

export function YogurtPaper({ selected, delivered, blocked, opts }: { selected: YogurtCow[]; delivered: YogurtCow[]; blocked: YogurtCow[]; opts: YogurtOptions }) {
  const sel = yogurtMix(selected, opts.factor)
  const all = yogurtMix(delivered, opts.factor)
  const selIds = new Set(selected.map((c) => c.animal_id))
  const rest = yogurtMix(
    delivered.filter((c) => !selIds.has(c.animal_id)),
    opts.factor,
  )
  const list = [...selected].sort((a, b) => a.label.localeCompare(b.label, 'de-CH', { numeric: true }))
  const withdrawal = blocked.filter((c) => c.withdrawal_until)
  const testDates = [...new Set(delivered.map((c) => c.test_date))].sort()
  const lastTest = testDates[testDates.length - 1]

  return (
    <div className="jp-paper">
      <div className="jp-sheet">
        <h1>Joghurt-Milch · Melkliste</h1>
        <div className="jp-sub">
          {dmy(localTodayIso())} · Ziel {opts.targetKg.toLocaleString('de-CH')} kg aus {opts.factor === 1 ? 'der Tagesmilch (2 Gemelke)' : '1 Gemelk'} · Auswahl nach{' '}
          {CRITERION_LABEL[opts.criterion]}
          {opts.maxCellCount != null ? `, Zellzahl bis ${opts.maxCellCount.toLocaleString('de-CH')}'000` : ''}
        </div>

        <h2>Diese {list.length} Kühe in die Joghurt-Milch</h2>
        <table className="jp-table">
          <thead>
            <tr>
              <th className="box">✓</th>
              <th>Kuh</th>
              <th>Ohrmarke</th>
              <th className="r">erwartet kg</th>
              <th className="r">Eiweiss %</th>
              <th className="r">Fett %</th>
              <th className="r">Zellzahl</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.animal_id}>
                <td className="box">
                  <span className="jp-box" />
                </td>
                <td>
                  <b>{c.label}</b>
                </td>
                <td>{c.ear_tag ? shortEarTag(c.ear_tag) : ''}</td>
                <td className="r">{f1(c.milk_kg * opts.factor)}</td>
                <td className="r">{f2(c.protein_pct)}</td>
                <td className="r">{f2(c.fat_pct)}</td>
                <td className="r">{cells(c.cell_count)}</td>
              </tr>
            ))}
            <tr className="jp-total">
              <td />
              <td colSpan={2}>Total Joghurt-Milch</td>
              <td className="r">{f1(sel.milkKg)}</td>
              <td className="r">{f2(sel.proteinPct)}</td>
              <td className="r">{f2(sel.fatPct)}</td>
              <td className="r">{cells(sel.cellCount)}</td>
            </tr>
          </tbody>
        </table>

        <h2>Zusammensetzung: Joghurt-Milch gegenüber der Gesamtmilch</h2>
        <table className="jp-table jp-cmp">
          <thead>
            <tr>
              <th />
              <th className="r">Kühe</th>
              <th className="r">kg</th>
              <th className="r">Eiweiss %</th>
              <th className="r">Fett %</th>
              <th className="r">Zellzahl</th>
            </tr>
          </thead>
          <tbody>
            <MixRow label="Joghurt-Milch" mix={sel} className="sel" />
            <MixRow label="übrige Milch" mix={rest} />
            <MixRow label="Gesamtmilch" mix={all} />
            <tr className="jp-total">
              <td>Joghurt − Gesamt</td>
              <td />
              <td />
              <td className="r">{diff(sel.proteinPct, all.proteinPct, 2, ' %')}</td>
              <td className="r">{diff(sel.fatPct, all.fatPct, 2, ' %')}</td>
              <td className="r">{diff(sel.cellCount, all.cellCount, 0, "'000", true)}</td>
            </tr>
          </tbody>
        </table>

        {withdrawal.length > 0 && (
          <div className="jp-warn">
            <b>Absetzfrist — Milch nicht abliefern:</b>{' '}
            {withdrawal.map((c) => `${c.label} (bis ${dmy(c.withdrawal_until!)})`).join(', ')}
          </div>
        )}

        <div className="jp-note">
          Erwartete Mengen und Gehalte aus der Milchwägung{lastTest ? ` vom ${dmy(lastTest)}` : ''} (fehlende Laboranalyse: letzte analysierte Wägung).
          Gesamtmilch = alle abgelieferten Kühe (ohne trockene und ohne Absetzfrist). Gehalte und Zellzahl mengengewichtet.
          {sel.unknownKg > 0 ? ` ${f1(sel.unknownKg)} kg der Joghurt-Milch ohne Laboranalyse — in den Gehalten nicht enthalten.` : ''}
        </div>
      </div>
    </div>
  )
}

/** Druck-Portal: liegt direkt unter <body>, damit beim Drucken nur das Papier erscheint. */
export function YogurtPrintPortal(props: Parameters<typeof YogurtPaper>[0]) {
  return (
    <>
      <style>{YOGURT_PRINT_CSS}</style>
      {createPortal(
        <div id="joghurt-print">
          <YogurtPaper {...props} />
        </div>,
        document.body,
      )}
    </>
  )
}
