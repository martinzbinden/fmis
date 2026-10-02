import { Fragment } from 'react'
import { animalKey, shortEarTag } from '@fmis/core/earTag'
import { localTodayIso } from '../lib/format'
import { STAGE_LABEL, stageOf, summarize, type LactationStage, type ReportRow, type ReportSummary } from '../lib/testReport'

// Drucklayout des Prüfberichts, Aufbau und Spalten wie der Papierbericht
// "Ergebnisse der Milchleistungskontrolle" (zwei Zeilen je Tier, A4 hoch).
// Masse in mm, damit Bildschirm-Vorschau und PDF gleich aussehen. Ketose-
// Klasse und Stoffwechsel-Kennzeichen rechnet die Zuchtorganisation mit
// eigenen Schwellen, die nicht im Export stehen — die Felder bleiben leer;
// in der Ketose-Spalte steht stattdessen der gemessene BHB-Wert der frisch
// abgekalbten Tiere (bis 60 Tage).

export const PAPER_CSS = `
#pruefbericht-print { display: none; }
.pr-paper { font-family: Helvetica, Arial, sans-serif; color: #000; font-size: 7.6pt; line-height: 1.25;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pr-sheet { background: #fff; width: 210mm; min-height: 297mm; padding: 10mm; box-sizing: border-box; margin: 0 auto 4mm;
  box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.pr-paper h1 { font-size: 11pt; font-weight: bold; margin: 0 0 3mm; }
.pr-paper h2 { font-size: 9pt; font-weight: bold; margin: 5mm 0 2mm; }
.pr-head { display: grid; grid-template-columns: 26mm 30mm 30mm 30mm; gap: 0 2mm; font-size: 8pt; }
.pr-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8mm; }
.pr-brand { text-align: right; font-size: 7pt; color: #1b4a68; }
.pr-brand b { display: block; font-size: 14pt; letter-spacing: .5pt; }
.pr-table { width: 190mm; table-layout: fixed; border-collapse: collapse; }
.pr-table td, .pr-table th { padding: 0.3mm 0.8mm; white-space: nowrap; overflow: hidden; vertical-align: baseline; }
.pr-table thead th { background: #1b4a68; color: #fff; font-weight: normal; font-size: 6.4pt; line-height: 1.15;
  border-left: 0.2mm solid #fff; vertical-align: bottom; }
.pr-table thead tr.pr-h2 th { border-top: 0.2mm solid #fff; }
.pr-table tbody.pr-cow { break-inside: avoid; page-break-inside: avoid; }
.pr-table tbody.pr-cow:nth-of-type(odd) td { background: #ccd9e2; }
.pr-table tbody.pr-cow td { border-left: 0.2mm solid #fff; }
.pr-table tbody.pr-cow tr:first-child td { padding-top: 0.6mm; }
.pr-table tbody.pr-cow tr:last-child td { padding-bottom: 0.6mm; }
.pr-table .r { text-align: right; } .pr-table .c { text-align: center; } .pr-table .l { text-align: left; }
.pr-table .b { font-weight: bold; } .pr-table .i { font-style: italic; } .pr-table td.name { font-size: 8.4pt; overflow: visible; }
.pr-table .sep { border-left: 0.5mm solid #000 !important; }
.pr-table tbody.pr-avg td { background: #1b4a68; color: #fff; border-left: 0.2mm solid #fff; padding-top: 1mm; padding-bottom: 1mm; }
.pr-table td.schalm { padding: 0; position: relative; }
.pr-note { font-size: 5.8pt; margin-top: 1mm; }
.pr-sheet + .pr-sheet { break-before: page; page-break-before: always; }
.pr-p2head { display: flex; justify-content: space-between; font-size: 8.5pt; margin-bottom: 4mm; }
.pr-text p { margin: 0 0 1.5mm; }
.pr-stats { width: 190mm; border-collapse: collapse; border: 0.2mm solid #000; margin-top: 1mm; }
.pr-stats th { font-weight: normal; font-size: 6.8pt; border-bottom: 0.2mm solid #000; padding: 0.6mm 1mm; vertical-align: bottom; }
.pr-stats td { padding: 0.4mm 1mm; text-align: right; }
.pr-stats td:first-child { text-align: right; }
.pr-stats .vl { border-left: 0.2mm solid #000; }
.pr-stats tr.pr-total td { border-top: 0.2mm solid #000; }
@media print {
  @page { size: A4 portrait; margin: 10mm 10mm 12mm;
    @bottom-right { content: "Seite " counter(page) " / " counter(pages); font: 6pt Helvetica, Arial, sans-serif; } }
  html, body { background: #fff !important; }
  body > *:not(#pruefbericht-print) { display: none !important; }
  #pruefbericht-print { display: block; }
  .pr-sheet { box-shadow: none; margin: 0; min-height: 0; width: auto; padding: 0; }
}
`

/** "16.08.2026" (Papierformat mit führenden Nullen). */
export function ddmmyyyy(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}
const ddmmyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`

/** TVD-Nummer wie auf dem Papier: "CH 120.1639.1545.3" bzw. "CH 2004.1511". */
function tvdNumber(earTag: string): string {
  const key = animalKey(earTag)
  if (key && /^CH120\d{9}$/.test(key)) return `CH 120.${shortEarTag(key)}`
  if (key && /^CH\d{8}$/.test(key)) return `CH ${shortEarTag(key)}`
  return earTag
}

const n = (v: number | null | undefined, d = 0) =>
  v == null ? '' : v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d })

function SchalmCross() {
  return (
    <svg viewBox="0 0 40 20" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <line x1="4" y1="10" x2="36" y2="10" stroke="#000" strokeWidth="0.6" />
      <line x1="20" y1="2" x2="20" y2="18" stroke="#000" strokeWidth="0.6" />
    </svg>
  )
}

function CowRows({ r, sccLimit }: { r: ReportRow; sccLimit: number }) {
  const t = r.test
  const label = [r.animal.lauf_nr, r.animal.name].filter(Boolean).join(' ')
  const std = r.standard
  const stdClass = std?.projected ? 'i' : 'b'
  const fresh = r.dim != null && r.dim <= 60
  return (
    <tbody className="pr-cow">
      <tr>
        <td className="l name">{label}</td>
        <td className="r">{t.calving_date ? ddmmyyyy(t.calving_date) : ''}</td>
        <td className="c">{n(t.lactation_number)}</td>
        <td className="r">{n(t.milk_morning_kg, 1)}</td>
        <td className="r b">{n(t.milk_kg, 1)}</td>
        <td className="l b sep">{n(t.fat_pct, 2)}</td>
        <td className="l b">{n(t.protein_pct, 2)}</td>
        <td className="l b">{n(t.urea_mg_dl)}</td>
        <td className="r b">{n(t.cell_count)}</td>
        <td className="r sep">{n(r.sccPrevious)}</td>
        <td className="r">{n(r.current?.days)}</td>
        <td className="r">{n(r.current?.milk)}</td>
        <td className="r">{n(r.current?.fat_pct, 2)}</td>
        <td className="r">{n(r.current?.protein_pct, 2)}</td>
        <td className="r">{n(r.current?.scc)}</td>
        <td className="c">{fresh ? n(t.bhb_mmol, 2) : ''}</td>
        <td className="schalm" rowSpan={2}>
          {t.cell_count != null && t.cell_count >= sccLimit && <SchalmCross />}
        </td>
      </tr>
      <tr>
        <td className="l">{r.lastService ? ddmmyy(r.lastService) : ''}</td>
        <td className="r">{tvdNumber(r.animal.ear_tag)}</td>
        <td className="c">{n(r.dim)}</td>
        <td className="r">{n(t.milk_evening_kg, 1)}</td>
        <td className="r">{n(t.sample_persistency)}</td>
        <td className="l sep">{n(t.lactose_pct, 2)}</td>
        <td className="l">{n(r.feq, 2)}</td>
        <td className="l" />
        <td />
        <td className="sep" />
        <td className={`r ${stdClass}`}>{n(std?.days)}</td>
        <td className={`r ${stdClass}`}>{n(std?.milk)}</td>
        <td className={`r ${stdClass}`}>{n(std?.fat_pct, 2)}</td>
        <td className={`r ${stdClass}`}>{n(std?.protein_pct, 2)}</td>
        <td className="r">{n(r.current?.persistency ?? std?.persistency)}</td>
        <td />
      </tr>
    </tbody>
  )
}

const COL_MM = [18, 26, 8, 10, 10, 10, 10, 11, 11, 11, 8, 12, 9, 9, 8, 7, 12]

/** Streudiagramm Fett-Eiweiss-Quotient × Harnstoff wie auf Seite 2, Ziffer =
 * Laktationsabschnitt. FEQ hier unkorrigiert (die Zuchtorganisation
 * korrigiert mit Zuchtwerten). */
function FeqUreaChart({ rows }: { rows: ReportRow[] }) {
  const W = 560
  const H = 300
  const x0 = 34
  const x1 = W - 6
  const y0 = 6
  const y1 = H - 24
  const xs = (u: number) => x0 + ((Math.min(Math.max(u, 2.5), 52.5) - 2.5) / 50) * (x1 - x0)
  const ys = (q: number) => y0 + ((Math.min(Math.max(q, 0.7), 2.1) - 0.7) / 1.4) * (y1 - y0)
  const region = (x: number, y: number, lines: string[]) =>
    lines.map((l, i) => (
      <text key={l + i} x={x} y={y + i * 7} fontSize="6" fill="#666" textAnchor="middle">
        {l}
      </text>
    ))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '150mm', display: 'block' }}>
      <rect x={xs(15)} y={y0} width={xs(18) - xs(15)} height={y1 - y0} fill="#e3e3e3" />
      <rect x={xs(25)} y={y0} width={xs(27) - xs(25)} height={y1 - y0} fill="#e3e3e3" />
      <rect x={x0} y={ys(1.36)} width={x1 - x0} height={ys(1.44) - ys(1.36)} fill="#e3e3e3" />
      <line x1={x0} x2={x1} y1={ys(1.5)} y2={ys(1.5)} stroke="#000" strokeWidth="0.6" strokeDasharray="4 3" />
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="#000" strokeWidth="1.6" />
      {region((xs(2.5) + xs(15)) / 2, y0 + 9, ['Energie optimal', 'Protein (–)'])}
      {region((xs(18) + xs(25)) / 2, y0 + 9, ['Energie optimal', 'Protein optimal'])}
      {region((xs(27) + xs(52.5)) / 2, y0 + 9, ['Energie optimal', 'Protein (+)'])}
      {region((xs(2.5) + xs(15)) / 2, y1 - 18, ['Verzehr (–)', 'Energie (–)', 'Protein (–)'])}
      {region((xs(18) + xs(25)) / 2, y1 - 18, ['Verzehr (–)', 'Energie (–)', 'Protein optimal'])}
      {region((xs(27) + xs(52.5)) / 2, y1 - 18, ['Verzehr (–)', 'Energie (–)', 'Protein (+)'])}
      {[0.8, 1, 1.2, 1.4, 1.6, 1.8, 2].map((q) => (
        <text key={q} x={x0 - 4} y={ys(q) + 3} fontSize="8" textAnchor="end">
          {q.toLocaleString('de-CH')}
        </text>
      ))}
      {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((u) => (
        <text key={u} x={xs(u)} y={y1 + 11} fontSize="8" textAnchor="middle">
          {u}
        </text>
      ))}
      <text x={x1} y={H - 2} fontSize="8" fontWeight="bold" textAnchor="end">
        Milchharnstoff (mg/dl)
      </text>
      {rows.map((r) =>
        r.feq != null && r.test.urea_mg_dl != null ? (
          <text key={r.animal.id} x={xs(r.test.urea_mg_dl)} y={ys(r.feq) + 3} fontSize="9" textAnchor="middle">
            {stageOf(r.dim) ?? '?'}
          </text>
        ) : null,
      )}
    </svg>
  )
}

function StageTable({ rows, summary }: { rows: ReportRow[]; summary: ReportSummary }) {
  const stages: { label: string; s: ReportSummary }[] = ([1, 2, 3] as LactationStage[]).map((st) => ({
    label: STAGE_LABEL[st],
    s: summarize(rows.filter((r) => stageOf(r.dim) === st)),
  }))
  const line = (label: string, s: ReportSummary, total = false) => (
    <tr key={label} className={total ? 'pr-total' : ''}>
      <td>{label}</td>
      <td>{s.count}</td>
      <td className="vl">{s.count ? n(s.fat_pct, 2) : ''}</td>
      <td>{s.count ? n(s.protein_pct, 2) : ''}</td>
      <td>{s.count ? n(s.urea, 1) : ''}</td>
      <td>{s.count ? n(s.lactose_pct, 2) : ''}</td>
      <td>{s.count ? n(s.scc) : ''}</td>
      <td className="vl">{s.count ? n(s.sampleMilk, 1) : ''}</td>
      <td>{s.count ? n(s.milk, 1) : ''}</td>
      <td>{s.count ? n(s.persistency, 1) : ''}</td>
    </tr>
  )
  return (
    <table className="pr-stats">
      <thead>
        <tr>
          <th style={{ textAlign: 'center', width: '42mm' }}>Laktationsabschnitt</th>
          <th>Tiere</th>
          <th className="vl">Fett<br />g/100 g</th>
          <th>Eiweiss<br />g/100 g</th>
          <th>Harnstoff<br />mg/dl</th>
          <th>Laktose<br />g/100 g</th>
          <th>Zellzahl<br />1000/ml</th>
          <th className="vl">Milch kg<br />Probe**</th>
          <th>
            <br />
            Tag
          </th>
          <th>Persistenz<br />%</th>
        </tr>
      </thead>
      <tbody>
        {stages.map(({ label, s }) => line(label, s))}
        {line('Alle Tiere', summary)}
        <tr className="pr-total">
          <td colSpan={2} style={{ textAlign: 'left' }}>
            Anteil Zellzahl &lt; 100'000: {summary.sccBelow100 == null ? '–' : `${Math.round(summary.sccBelow100 * 100)} %`}
          </td>
          <td colSpan={3} style={{ textAlign: 'left' }}>
            &gt; 200'000: {summary.sccAbove200 == null ? '–' : `${Math.round(summary.sccAbove200 * 100)} %`}
          </td>
          <td colSpan={2}>Total Milch kg:</td>
          <td>{n(summary.totalSampleMilk, 1)}</td>
          <td>{n(summary.totalMilk, 1)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}

export default function PaperReport({
  date,
  rows,
  summary,
  title,
  calvingWord,
  sccLimit,
  withEcm,
}: {
  date: string
  rows: ReportRow[]
  summary: ReportSummary
  title: string
  calvingWord: string
  /** Zellzahl (1000/ml), ab der das Schalmtest-Feld angekreuzt wird. */
  sccLimit: number
  withEcm: boolean
}) {
  const today = ddmmyyyy(localTodayIso())
  const morning = rows.filter((r) => r.test.milk_morning_kg != null).length
  const evening = rows.filter((r) => r.test.milk_evening_kg != null).length
  const sampleTime = morning && evening ? 'Morgen und Abend' : morning ? 'Morgen' : evening ? 'Abend' : '–'
  const tierWord = calvingWord === 'Ablammdatum' ? 'Tiere' : 'Kühe'

  return (
    <div className="pr-paper">
      <section className="pr-sheet">
        <div className="pr-top">
          <div>
            <h1>Ergebnisse der Milchleistungskontrolle</h1>
            <div className="pr-head">
              <span>Kontrolldatum</span>
              <span>{ddmmyyyy(date)}</span>
              <span>Druckdatum</span>
              <span>{today}</span>
              <span>Gewogenes Gemelk</span>
              <span>{sampleTime}</span>
              <span>Herde</span>
              <span>{title}</span>
            </div>
          </div>
          <div className="pr-brand">
            <b>FMIS</b>
            aus Herdebuch-Export erstellt
          </div>
        </div>

        <table className="pr-table">
          <colgroup>
            {COL_MM.map((w, i) => (
              <col key={i} style={{ width: `${w}mm` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="l">Name</th>
              <th className="r">{calvingWord}</th>
              <th className="c">Lakt.</th>
              <th className="c" colSpan={2}>
                Milch kg
                <br />
                <span style={{ float: 'left' }}>Morgen</span>
                <span style={{ float: 'right' }}>Total</span>
              </th>
              <th className="l">
                Fett*
                <br />
                Laktose*
              </th>
              <th className="l">
                Eiweiss*
                <br />
                FEQ
              </th>
              <th className="l">
                Harnstoff*
                <br />
                mg/dl
              </th>
              <th className="r">
                Zellzahl*
                <br />
                Aktuell
              </th>
              <th className="r" rowSpan={2} style={{ verticalAlign: 'middle' }}>
                Zellzahl
                <br />
                Vorprobe
              </th>
              <th className="c" colSpan={5}>
                <span style={{ float: 'left', marginLeft: '6mm' }}>Laufende Laktation</span>
                <span style={{ float: 'right' }}>ZZ</span>
                <br />
                <span style={{ float: 'left' }}>Tage</span>
                <span style={{ marginLeft: '4mm' }}>Milch</span>
                <span style={{ marginLeft: '5mm' }}>Fett</span>
                <span style={{ marginLeft: '3mm' }}>Eiweiss</span>
                <span style={{ float: 'right' }}>Pers.</span>
              </th>
              <th className="c" rowSpan={2} style={{ verticalAlign: 'top', fontSize: '5.6pt' }}>
                Ketose
                <br />
                BHB
              </th>
              <th className="c" rowSpan={2} style={{ verticalAlign: 'top' }}>
                Schalmtest
              </th>
            </tr>
            <tr className="pr-h2">
              <th className="l">Deckdatum</th>
              <th className="r">TVD–Nr.</th>
              <th className="c">Tage</th>
              <th className="c">Abend</th>
              <th className="r">Pers.</th>
              <th className="c" colSpan={2}>
                g/100 g
              </th>
              <th className="l">Stoffw.</th>
              <th className="r">1000/ml</th>
              <th className="c" colSpan={5} style={{ fontSize: '5.8pt' }}>
                Aufgerechnete oder Standardlaktation
              </th>
            </tr>
          </thead>
          {rows.map((r) => (
            <CowRows key={r.animal.id} r={r} sccLimit={sccLimit} />
          ))}
          <tbody className="pr-avg">
            <tr>
              <td className="l" colSpan={2}>
                Durchschnitt
              </td>
              <td className="c">
                {n(summary.lactation, 1)}
                <br />
                {n(summary.dim)}
              </td>
              <td />
              <td className="r">{n(summary.milk, 1)}</td>
              <td className="l">
                {n(summary.fat_pct, 2)}
                <br />
                {n(summary.lactose_pct, 2)}
              </td>
              <td className="l">
                {n(summary.protein_pct, 2)}
                <br />
                {n(summary.feq, 2)}
              </td>
              <td className="l">{n(summary.urea, 1)}</td>
              <td className="r">{n(summary.scc)}</td>
              <td />
              <td />
              <td className="r" colSpan={1}>
                {summary.stdMilk != null ? `${n(summary.stdMilk)}**` : ''}
              </td>
              <td className="r">{n(summary.stdFat, 2)}</td>
              <td className="r">{n(summary.stdProtein, 2)}</td>
              <td />
              <td />
              <td />
            </tr>
          </tbody>
        </table>
        <div className="pr-note">
          *Durchschnitt Gehalte, Harnstoff und Zellzahl nach Milchmenge gewichtet · **Durchschnitt Standardlaktation der {tierWord} auf dem
          Bericht · kursiv = aufgerechnete Laktation · Ketose-Klasse und Stoffwechsel-Kennzeichen rechnet die Zuchtorganisation, sie sind im
          Export nicht enthalten; angegeben ist der gemessene BHB-Wert bis 60 Tage nach der Geburt · Kreuz im Schalmtest-Feld ab Zellzahl{' '}
          {(sccLimit * 1000).toLocaleString('de-CH')}
        </div>
      </section>

      <section className="pr-sheet">
        <div className="pr-p2head">
          <span>Herde: {title}</span>
          <span>Prüfbericht Kontrolldatum: {ddmmyyyy(date)}</span>
        </div>
        <h2>Fett-Eiweiss-Quotient und Harnstoff</h2>
        <div className="pr-text">
          <p>
            <b>Fett-Eiweiss-Quotient (FEQ):</b> bis 1.4 spricht für eine gute Energieversorgung, darüber für Energiemangel. Sehr tiefe
            Werte (unter etwa 1.0) können auf Strukturmangel hinweisen.
          </p>
          <p>
            <b>Harnstoff:</b> Zielbereich 15–27 mg/dl, optimal 18–25 mg/dl. Tiefer: Proteinmangel, höher: Proteinüberschuss bzw.
            Energiemangel im Pansen.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '4mm', alignItems: 'flex-start', marginTop: '3mm' }}>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '8pt', marginBottom: '1mm' }}>Fett-Eiweiss-Quotient (unkorrigiert)</div>
            <FeqUreaChart rows={rows} />
          </div>
          <div style={{ fontSize: '7pt', paddingTop: '20mm', lineHeight: 1.6 }}>
            1 = unter 100 Laktationstage
            <br />2 = 100 – 200 Laktationstage
            <br />3 = über 200 Laktationstage
            <br />– – FEQ Jersey (1.5)
            <br />(–) bedeutet Mangel
            <br />(+) bedeutet Überschuss
          </div>
        </div>

        <h2>Durchschnittswerte (gewichtet nach Milchmenge)</h2>
        <StageTable rows={rows} summary={summary} />
        <div className="pr-note">**Differenzen zur Tagesmilchmenge entstehen, weil nur ein Gemelk gewogen wird.</div>
        {rows.length > 0 && (
          <Fragment>
            <h2>Zusätzliche Kennzahlen</h2>
            <div className="pr-text">
              <p>
                ⌀ Fett {n(summary.fatKg, 2)} kg · ⌀ Eiweiss {n(summary.proteinKg, 2)} kg · ⌀ Fett+Eiweiss {n(summary.fatProteinKg, 2)} kg
                {withEcm && ` · ⌀ ECM ${n(summary.ecmKg, 1)} kg`} — je Tier und Tag, aus Probemilch und Gehalten
              </p>
            </div>
          </Fragment>
        )}
      </section>
    </div>
  )
}
