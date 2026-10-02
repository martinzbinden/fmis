// SMG "Abstammungs- und Leistungsausweis" (PDF, A4 quer) lesen: Seite 1
// Stammdaten des Tiers, Seite 2 drei Generationen Vorfahren in einem festen
// Raster (Spalte 1: Vater/Mutter, Spalte 2: vier Grosseltern, Spalte 3: acht
// Urgrosseltern), jede Box mit
//
//   SEPPI HB weiss                      Parasitenresistenz: B
//   1822.5245            100 % LAC   07.01.18 2
//   ZW: 2026   93%   98 103 100 101   ZF:
//
// Die vier ZW-Zahlen sind dieselben Indizes wie im Herdebuch-Export K09 der
// Schafe (Milch, Fett %, Eiweiss %, MIW = Gesamtzuchtwert, siehe
// herdbookRecords.ts parseK09Sheep) — per Regression gegen die K09-Werte der
// Herde geprüft. Positionen werden aus den pdf.js-Textkoordinaten gelesen
// (Ursprung oben links), die Zuordnung zur Ahnen-Position aus Spalte und
// Höhe der Box im Raster — fehlende Vorfahren lassen so keine Lücke rutschen.

export interface PdfItem {
  str: string
  x: number
  y: number
}

export interface PdfPageText {
  width: number
  height: number
  items: PdfItem[]
}

export interface CertificateBreedingValues {
  year: number
  reliability: number | null
  idx_milk: number
  idx_fat_pct: number
  idx_protein_pct: number
  gzw: number
}

export interface CertificateAnimal {
  /** S = Vater, D = Mutter, SD = Mutter des Vaters usw.; '' = das Tier selbst. */
  position: string
  ear_tag: string
  name: string | null
  birth_date: string | null
  breed_code: string | null
  breeding_values: CertificateBreedingValues | null
}

export interface SmgCertificate {
  subject: CertificateAnimal
  /** Druckdatum unten rechts auf Seite 1. */
  document_date: string | null
  inbreeding_pct: number | null
  ancestors: CertificateAnimal[]
}

const POSITIONS = [['S', 'D'], ['SS', 'SD', 'DS', 'DD'], ['SSS', 'SSD', 'SDS', 'SDD', 'DSS', 'DSD', 'DDS', 'DDD']]

const ID_RE = /^(\d{3,4}\.\d{4}|\d{3}\.\d{3}\.\d{3}(?: [A-Z]{2})?|[A-Z]{2}\s?\d{6,14}|\d{6,14}(?: [A-Z]{2})?)$/
const BREED_RE = /^\d+(?:[.,]\d+)?\s?%\s+([A-Z]{2,4})$/
const SHORT_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2})\b/
const LINE_TOLERANCE = 2

/** Tier-ID wie auf dem Ausweis → Schreibweise für den Stammbaum. Schweizer
 * Schafe "1822.5245" → "CH18225245" (= animalKey der Ohrmarke), ausländische
 * "372.457.830 AT" → "AT372457830", alles andere ohne Leerzeichen/Punkte. */
export function certificateEarTag(id: string): string {
  const s = id.trim()
  const ch = /^(\d{4})\.(\d{4})$/.exec(s)
  if (ch) return `CH${ch[1]}${ch[2]}`
  const foreign = /^([\d.]+)\s+([A-Z]{2})$/.exec(s)
  if (foreign) return `${foreign[2]}${foreign[1].replace(/\./g, '')}`
  return s.replace(/[\s.]/g, '').toUpperCase()
}

function shortDate(s: string, today: string): string | null {
  const m = SHORT_DATE_RE.exec(s)
  if (!m) return null
  const yy = Number(m[3])
  const century = yy <= Number(today.slice(2, 4)) ? 2000 : 1900
  return `${century + yy}-${m[2]}-${m[1]}`
}

function longDate(s: string): string | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function cleanName(header: string): string | null {
  const name = header
    .replace(/Parasitenresistenz:.*$/, '')
    .replace(/\s+HB\b.*$/, '')
    .replace(/^HB\b.*$/, '')
    .trim()
  return name || null
}

/** Items einer Zeile (gleiches y ± Toleranz), nach x sortiert. */
function lineAt(items: PdfItem[], y: number, minX = -Infinity, maxX = Infinity): PdfItem[] {
  return items.filter((i) => Math.abs(i.y - y) <= LINE_TOLERANCE && i.x >= minX && i.x < maxX).sort((a, b) => a.x - b.x)
}

function valueRightOf(items: PdfItem[], label: string): string | null {
  const l = items.find((i) => i.str.trim() === label)
  if (!l) return null
  const v = lineAt(items, l.y, l.x + 1).find((i) => i.x > l.x)
  return v ? v.str.trim() : null
}

function parseBreedingValues(line: PdfItem[]): CertificateBreedingValues | null {
  const text = line.map((i) => i.str).join(' ')
  const m = /ZW:\s*(\d{4})\s+(?:(\d{1,3})\s?%\s+)?(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\b/.exec(text)
  if (!m) return null
  return {
    year: Number(m[1]),
    reliability: m[2] ? Number(m[2]) : null,
    idx_milk: Number(m[3]),
    idx_fat_pct: Number(m[4]),
    idx_protein_pct: Number(m[5]),
    gzw: Number(m[6]),
  }
}

export function isSmgCertificate(pages: PdfPageText[]): boolean {
  return pages.length >= 2 && pages[0].items.some((i) => /Abstammungs\s*[–-]\s*und Leistungsausweis/.test(i.str))
}

export function parseSmgCertificate(pages: PdfPageText[], today: string): SmgCertificate {
  if (!isSmgCertificate(pages)) throw new Error('Kein SMG-Abstammungs- und Leistungsausweis erkannt.')
  const p1 = pages[0].items
  const id = valueRightOf(p1, 'Nummer/Zeichen:')
  if (!id || !ID_RE.test(id)) throw new Error('Nummer des Tiers auf Seite 1 nicht gefunden.')
  const breed = valueRightOf(p1, 'Rasse:')
  const inbreeding = valueRightOf(p1, 'Inzuchtgrad:')
  const footerDate = p1
    .filter((i) => i.y > pages[0].height - 40 && /^\d{2}\.\d{2}\.\d{4}$/.test(i.str.trim()))
    .map((i) => longDate(i.str))[0]
  const subject: CertificateAnimal = {
    position: '',
    ear_tag: certificateEarTag(id),
    name: cleanName(valueRightOf(p1, 'Name:') ?? ''),
    birth_date: longDate(valueRightOf(p1, 'Geburtsdatum:') ?? ''),
    breed_code: breed ? (/^([A-Z]{2,4})/.exec(breed)?.[1] ?? null) : null,
    breeding_values: null,
  }

  // Seite 2: Boxen über die ID-Zeile finden (ID links, Rasse "100 % LAC" auf gleicher Höhe).
  const { width, height, items } = pages[1]
  const colOf = (x: number) => (x < width * 0.335 ? 0 : x < width * 0.665 ? 1 : 2)
  const blocks: { col: number; y: number; animal: Omit<CertificateAnimal, 'position'> }[] = []
  for (const it of items) {
    const s = it.str.trim()
    if (!ID_RE.test(s) || certificateEarTag(s) === subject.ear_tag) continue
    const col = colOf(it.x)
    const colMin = col * width / 3 - 20
    const colMax = (col + 1) * width / 3 - 20
    const line = lineAt(items, it.y, colMin, colMax)
    const breedItem = line.find((i) => BREED_RE.test(i.str.trim()))
    if (!breedItem) continue
    const dateItem = line.find((i) => i.x > breedItem.x && SHORT_DATE_RE.test(i.str.trim()))
    // Kopfzeile (Name) direkt darüber, ZW-Zeile darunter — beide bündig mit der ID.
    const header = items
      .filter((i) => Math.abs(i.x - it.x) <= 4 && i.y < it.y && it.y - i.y < 20)
      .sort((a, b) => b.y - a.y)[0]
    const zwStart = items
      .filter((i) => Math.abs(i.x - it.x) <= 4 && i.y > it.y && i.y - it.y < 25 && i.str.trim().startsWith('ZW:'))
      .sort((a, b) => a.y - b.y)[0]
    blocks.push({
      col,
      y: header?.y ?? it.y,
      animal: {
        ear_tag: certificateEarTag(s),
        name: header ? cleanName(header.str) : null,
        birth_date: dateItem ? shortDate(dateItem.str.trim(), today) : null,
        breed_code: BREED_RE.exec(breedItem.str.trim())?.[1] ?? null,
        breeding_values: zwStart ? parseBreedingValues(lineAt(items, zwStart.y, zwStart.x - 1, colMax)) : null,
      },
    })
  }
  if (blocks.length === 0) throw new Error('Keine Vorfahren auf Seite 2 gefunden.')

  // Raster: oberste Box = Oberkante, Seitenende abzüglich Rand = Unterkante.
  const top = Math.min(...blocks.map((b) => b.y))
  const bottom = height - 12
  const ancestors: CertificateAnimal[] = []
  for (const b of blocks) {
    const n = POSITIONS[b.col].length
    const slot = Math.min(n - 1, Math.max(0, Math.round((b.y - top) / ((bottom - top) / n))))
    ancestors.push({ position: POSITIONS[b.col][slot], ...b.animal })
  }
  const inbreedingPct = inbreeding ? Number(inbreeding.replace('%', '').replace(',', '.').trim()) : null
  return {
    subject,
    document_date: footerDate ?? null,
    inbreeding_pct: inbreedingPct != null && Number.isFinite(inbreedingPct) ? inbreedingPct : null,
    ancestors,
  }
}

/** Text mit Koordinaten aus einem PDF (pdf.js, im Browser). */
export async function readPdfText(buffer: ArrayBuffer): Promise<PdfPageText[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  const pages: PdfPageText[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items: PdfItem[] = []
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const t = pdfjs.Util.transform(viewport.transform, it.transform)
      items.push({ str: it.str, x: t[4], y: t[5] })
    }
    pages.push({ width: viewport.width, height: viewport.height, items })
  }
  return pages
}
