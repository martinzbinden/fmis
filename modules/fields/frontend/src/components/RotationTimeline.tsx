import { useMemo } from 'react'
import { colorForKultur } from '../lib/kulturColor'
import type { FieldDeclaration, FieldLineageSummary } from '../types'

const YEAR_COL_WIDTH = 110
const LABEL_COL_WIDTH = 190
const ROW_HEIGHT = 32

interface Props {
  lineages: FieldLineageSummary[]
  declarationsByLineage: Map<string, FieldDeclaration[]>
  onFocusMap: (lineage: FieldLineageSummary) => void
  onOpenDetails: (lineage: FieldLineageSummary) => void
}

interface Run {
  key: string
  startIdx: number
  length: number
  decl: FieldDeclaration
}

/** Gleiche Kultur (+ Sorte) zweier Deklarationen — Grundlage fürs Zusammenziehen. */
function sameCrop(a: FieldDeclaration, b: FieldDeclaration): boolean {
  return a.kultur_code === b.kultur_code && (a.kultur_name_de ?? null) === (b.kultur_name_de ?? null) && (a.sorte ?? null) === (b.sorte ?? null)
}

/**
 * Zerlegt die Deklarationen einer Parzelle in "Lanes" (Position 1, 2, ...
 * pro Jahr — Position 2+ ist i.d.R. Zwischenfutter) und fasst innerhalb
 * jeder Lane aufeinanderfolgende Jahre mit identischer Kultur (+Sorte) zu
 * einem Balken zusammen, der nur einmal beschriftet wird.
 */
function computeLanes(decls: FieldDeclaration[], years: number[]): Run[][] {
  const byYear = new Map<number, FieldDeclaration[]>()
  for (const d of decls) {
    const list = byYear.get(d.jahr) ?? []
    list.push(d)
    byYear.set(d.jahr, list)
  }
  for (const list of byYear.values()) list.sort((a, b) => a.sequence_in_year - b.sequence_in_year)

  const laneCount = Math.max(0, ...[...byYear.values()].map((l) => l.length))
  const lanes: Run[][] = []
  for (let lane = 0; lane < laneCount; lane++) {
    const runs: Run[] = []
    let current: Run | null = null
    years.forEach((y, idx) => {
      const decl = byYear.get(y)?.[lane]
      if (decl && current && sameCrop(current.decl, decl)) {
        current.length++
      } else {
        if (current) runs.push(current)
        current = decl ? { key: decl.id, startIdx: idx, length: 1, decl } : null
      }
    })
    if (current) runs.push(current)
    lanes.push(runs)
  }
  return lanes
}

/**
 * Fruchtfolge als Zeitstrahl: eine Zeile pro Parzelle, ein Balken pro
 * Kultur-Deklaration, beschriftet mit Kultur (und Sorte, falls bekannt).
 * Bleibt eine Kultur über mehrere Jahre identisch, wird ein einziger
 * durchgehender Balken gezeichnet statt einer pro Jahr. Solange keine
 * Kulturmassnahmen (Saat-/Erntedatum) erfasst sind, füllt jede Deklaration
 * ihr ganzes Jahr — sobald start_date/end_date gesetzt sind (siehe
 * schema/0003_dates.sql), werden die Balken automatisch auf den echten
 * Zeitraum verkürzt.
 */
export default function RotationTimeline({
  lineages,
  declarationsByLineage,
  onFocusMap,
  onOpenDetails,
}: Props) {
  const years = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const decls of declarationsByLineage.values()) {
      for (const d of decls) {
        if (d.jahr < min) min = d.jahr
        if (d.jahr > max) max = d.jahr
      }
    }
    if (!Number.isFinite(min)) return []
    const result: number[] = []
    for (let y = min; y <= max; y++) result.push(y)
    return result
  }, [declarationsByLineage])

  if (years.length === 0 || lineages.length === 0) {
    return <p className="text-center text-gray-500">Keine Daten für den Zeitstrahl.</p>
  }

  const trackWidth = years.length * YEAR_COL_WIDTH

  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <div style={{ minWidth: LABEL_COL_WIDTH + trackWidth }}>
        <div className="flex border-b">
          <div
            className="sticky left-0 z-10 shrink-0 bg-white p-2 text-xs font-medium text-gray-500"
            style={{ width: LABEL_COL_WIDTH }}
          >
            Parzelle
          </div>
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${years.length}, ${YEAR_COL_WIDTH}px)` }}>
            {years.map((y) => (
              <div key={y} className="p-2 text-center text-xs font-medium text-gray-500">
                {y}
              </div>
            ))}
          </div>
        </div>

        {lineages.map((lineage) => {
          const decls = declarationsByLineage.get(lineage.lineage_id) ?? []
          const lanes = computeLanes(decls, years)
          const rowHeight = Math.max(1, lanes.length) * ROW_HEIGHT

          return (
            <div key={lineage.lineage_id} className="flex border-b last:border-0">
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-white p-2 text-xs font-medium text-gray-800"
                style={{ width: LABEL_COL_WIDTH }}
                title={lineage.flurname ?? undefined}
              >
                <span className="min-w-0 flex-1 truncate">
                  {lineage.flurname ?? lineage.kultur_name_de ?? lineage.kultur_code}
                </span>
                <button
                  type="button"
                  onClick={() => onFocusMap(lineage)}
                  title="Auf Karte zeigen"
                  aria-label="Auf Karte zeigen"
                  className="rounded p-1 text-sm leading-none active:bg-gray-100"
                >
                  🌐
                </button>
                <button
                  type="button"
                  onClick={() => onOpenDetails(lineage)}
                  title="Details"
                  aria-label="Details"
                  className="rounded p-1 text-sm leading-none text-gray-500 active:bg-gray-100"
                >
                  ☰
                </button>
              </div>
              <div
                className="relative flex-1"
                style={{
                  height: rowHeight,
                  backgroundImage: `repeating-linear-gradient(to right, #f3f4f6 0, #f3f4f6 1px, transparent 1px, transparent ${YEAR_COL_WIDTH}px)`,
                }}
              >
                {lanes.map((runs, laneIdx) =>
                  runs.map((run) => (
                    <div
                      key={run.key}
                      className="absolute overflow-hidden rounded-sm px-1.5 py-0.5"
                      style={{
                        left: run.startIdx * YEAR_COL_WIDTH + 2,
                        width: run.length * YEAR_COL_WIDTH - 4,
                        top: laneIdx * ROW_HEIGHT + 2,
                        height: ROW_HEIGHT - 4,
                        backgroundColor: colorForKultur(run.decl.kultur_code),
                      }}
                      title={`${run.decl.kultur_name_de ?? run.decl.kultur_code}${run.decl.sorte ? ' · ' + run.decl.sorte : ''} (${run.decl.jahr}${run.length > 1 ? `–${run.decl.jahr + run.length - 1}` : ''}${run.decl.source === 'plan' ? ', geplant' : ''})`}
                    >
                      <div className="truncate text-[11px] font-semibold leading-tight text-white">
                        {run.decl.kultur_name_de ?? run.decl.kultur_code}
                      </div>
                      {run.decl.sorte && (
                        <div className="truncate text-[9px] leading-tight text-white/80">{run.decl.sorte}</div>
                      )}
                    </div>
                  )),
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
