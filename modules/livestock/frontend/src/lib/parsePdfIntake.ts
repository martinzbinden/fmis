import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api'
import type { SeedRow } from './importCsv'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const EARTAG_RE = /^CH\d+$/
const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2})$/
const SEX_RE = /^[mwk]$/
// Innerhalb eines Tier-Eintrags liegen Ohrmarke/Datum/Geschlecht im TVD-Begleitdokument
// alle innerhalb weniger Punkte y-Abstand; zwischen zwei Tieren liegt eine deutlich
// grössere Lücke (siehe validiertes Layout in den Testdaten).
const ROW_GROUP_GAP_PT = 18

interface TextItem {
  str: string
  x: number
  y: number
}

function toIsoDate(dmy: string): string {
  const m = dmy.match(DATE_RE)
  if (!m) throw new Error(`Ungültiges Datum: ${dmy}`)
  const [, dd, mm, yy] = m
  return `20${yy}-${mm}-${dd}`
}

function clusterByRow(items: TextItem[]): TextItem[][] {
  const groups: TextItem[][] = []
  let current: TextItem[] = []
  let prevY: number | null = null
  for (const item of items) {
    if (prevY !== null && prevY - item.y > ROW_GROUP_GAP_PT) {
      if (current.length) groups.push(current)
      current = []
    }
    current.push(item)
    prevY = item.y
  }
  if (current.length) groups.push(current)
  return groups
}

export interface PdfParseResult {
  animals: SeedRow[]
  expectedTotal: number | null
  warnings: string[]
}

/**
 * Extrahiert die Tierliste (Ohrmarke, Geburtsdatum, Geschlecht) direkt aus einem
 * TVD-Begleitdokument-PDF ("Tierliste - Beilage zum Begleitdokument"), beliebig
 * viele Seiten/Tiere. Läuft vollständig im Browser (pdfjs), keine Serveranfrage
 * nötig. ORIGINAL/KOPIE-Seiten enthalten dieselben Tiere mehrfach — Duplikate
 * werden anhand der Ohrmarke entfernt (erstes Vorkommen zählt).
 */
export async function parseIntakePdf(fileBuffer: ArrayBuffer): Promise<PdfParseResult> {
  const doc = await pdfjsLib.getDocument({ data: fileBuffer }).promise
  const warnings: string[] = []
  const rows: (SeedRow & { page: number })[] = []
  let expectedTotal: number | null = null

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const pageText = content.items.map((i) => ('str' in i ? i.str : '')).join(' ')

    if (expectedTotal === null) {
      const totalMatch = pageText.match(/Total\s+Tiere:\s*(\d+)/)
      if (totalMatch) expectedTotal = Number(totalMatch[1])
    }

    if (!pageText.includes('Tierliste') || !pageText.includes('Geburtsdatum')) continue

    const relevant: TextItem[] = content.items
      .filter((i): i is PdfTextItem => 'str' in i && 'transform' in i)
      .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5] }))
      .filter((i) => i.str && (EARTAG_RE.test(i.str) || DATE_RE.test(i.str) || SEX_RE.test(i.str)))

    const midX = page.view[2] / 2
    const left = relevant.filter((i) => i.x < midX).sort((a, b) => b.y - a.y)
    const right = relevant.filter((i) => i.x >= midX).sort((a, b) => b.y - a.y)

    for (const column of [left, right]) {
      for (const group of clusterByRow(column)) {
        const earTag = group.find((i) => EARTAG_RE.test(i.str))?.str
        const dateStr = group.find((i) => DATE_RE.test(i.str))?.str
        const sex = group.find((i) => SEX_RE.test(i.str))?.str
        if (earTag && dateStr && sex) {
          rows.push({ ear_tag: earTag, birth_date: toIsoDate(dateStr), sex: sex as SeedRow['sex'], page: pageNum })
        } else if (earTag || dateStr) {
          // Legende ("m = männlich, w = weiblich, k = kastriert") erzeugt Gruppen mit
          // nur einem Geschlechts-Buchstaben ohne Ohrmarke/Datum — die ignorieren wir
          // still. Alles andere (Ohrmarke ohne Datum o.ä.) ist ein echter Parse-Fehler.
          warnings.push(`Seite ${pageNum}: unvollständiger Eintrag erkannt (${JSON.stringify(group.map((i) => i.str))})`)
        }
      }
    }
  }

  const byEarTag = new Map<string, SeedRow>()
  for (const row of rows) {
    if (!byEarTag.has(row.ear_tag)) byEarTag.set(row.ear_tag, row)
  }
  const animals = [...byEarTag.values()].sort((a, b) => a.ear_tag.localeCompare(b.ear_tag))

  if (expectedTotal !== null && expectedTotal !== animals.length) {
    warnings.push(
      `Dokument nennt "Total Tiere: ${expectedTotal}", erkannt wurden aber ${animals.length}. Bitte Ergebnis vor dem Import prüfen.`,
    )
  }

  return { animals, expectedTotal, warnings }
}
