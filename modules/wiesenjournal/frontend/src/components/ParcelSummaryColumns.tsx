import type { ParcelSummary } from '../lib/parcelSummary'

// Angehängte Summen-Spalten (Weide/Ertrag/N kg) — rechts fix am Rand des
// Rasters (sticky), farblich abgehoben, aber Zeile für Zeile exakt auf der
// Tabelle: keine separate Box mit eigener Scroll-/Zeilenhöhe mehr, sondern
// echte zusätzliche Zellen derselben Tabellenzeile (siehe JournalGrid.tsx /
// JournalGridClassic.tsx, Umschalter in pages/JournalGrid.tsx).
export const SUMMARY_COL_WIDTHS = { weide: 40, ertrag: 64, nkg: 48 } as const
export const SUMMARY_TOTAL_WIDTH = SUMMARY_COL_WIDTHS.weide + SUMMARY_COL_WIDTHS.ertrag + SUMMARY_COL_WIDTHS.nkg

const CELL_CLASS = 'sticky z-20 flex shrink-0 items-center justify-end overflow-hidden border-l border-blue-200 bg-blue-50/80 px-1 text-blue-900'

// Kopfzeile hat KEINE feste Höhe (wächst mit ihrem Inhalt) — hier bewusst
// keine explizite Höhe setzen, sonst würde ausgerechnet die Kopfzeile durch
// den kürzeren Inhalt dieser Zellen schrumpfen. Flexbox-Stretch (Standard)
// gleicht das automatisch an die Tages-Kopfzellen an, die ebenfalls keine
// eigene Höhe setzen.
export function SummaryHeaderCells() {
  return (
    <>
      <div
        className={`${CELL_CLASS} text-[9px] font-semibold`}
        style={{ width: SUMMARY_COL_WIDTHS.weide, right: SUMMARY_COL_WIDTHS.ertrag + SUMMARY_COL_WIDTHS.nkg }}
        title="Weidetage"
      >
        Weide
      </div>
      <div
        className={`${CELL_CLASS} text-[9px] font-semibold`}
        style={{ width: SUMMARY_COL_WIDTHS.ertrag, right: SUMMARY_COL_WIDTHS.nkg }}
        title="Ertrag total"
      >
        Ertrag
      </div>
      <div className={`${CELL_CLASS} text-[9px] font-semibold`} style={{ width: SUMMARY_COL_WIDTHS.nkg, right: 0 }} title="Stickstoff total (N kg)">
        N kg
      </div>
    </>
  )
}

export function SummaryRowCells({ summary, height, tinted }: { summary: ParcelSummary | undefined; height: number; tinted: boolean }) {
  const bg = tinted ? 'bg-blue-50' : 'bg-blue-50/60'
  return (
    <>
      <div
        className={`${CELL_CLASS} ${bg} text-[10px] font-medium`}
        style={{ width: SUMMARY_COL_WIDTHS.weide, height, right: SUMMARY_COL_WIDTHS.ertrag + SUMMARY_COL_WIDTHS.nkg }}
      >
        {summary?.weideTage || ''}
      </div>
      <div
        className={`${CELL_CLASS} ${bg} text-[10px] font-medium`}
        style={{ width: SUMMARY_COL_WIDTHS.ertrag, height, right: SUMMARY_COL_WIDTHS.nkg }}
        title={summary?.ertrag ?? undefined}
      >
        {summary?.ertrag ?? ''}
      </div>
      <div
        className={`${CELL_CLASS} ${bg} text-[10px] font-medium`}
        style={{ width: SUMMARY_COL_WIDTHS.nkg, height, right: 0 }}
        title={summary?.gaben ? `${summary.gaben} Gaben` : undefined}
      >
        {summary?.nKg || ''}
      </div>
    </>
  )
}
