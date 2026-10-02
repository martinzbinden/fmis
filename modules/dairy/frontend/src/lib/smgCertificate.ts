// SMG "Abstammungs- und Leistungsausweis" (PDF, A4 quer) lesen.
//
// Seite 1: das Tier selbst — Stammdaten, Gesundheit/Genetik (Maedi Visna,
// CCR5, Scrapie, Parasitenresistenz), Punktierungen, LBE, eigener Zuchtwert,
// Töchterleistungen und Anzahl Nachkommen, je als Tabelle mit Kopfzeile.
// Werte werden der Spalte zugeordnet, deren Kopf am nächsten liegt.
//
// Seite 2: drei Generationen Vorfahren in einem festen Raster (Spalte 1:
// Vater/Mutter, Spalte 2: vier Grosseltern, Spalte 3: acht Urgrosseltern).
// Jede Box beginnt mit
//
//   SEPPI HB weiss                      Parasitenresistenz: B
//   1822.5245            100 % LAC   07.01.18 2
//   ZW: 2026   93%   98 103 100 101   ZF:
//
// gefolgt von Punktierungen ("14.05.19 J 4 5 · · 5"), LBE ("02.05.23 91 / 90
// / 89 / 80 / 87 Bemerkungen…"), bei Vätern Töchterleistungen je Laktation,
// bei Müttern die Laktationen ("1 AT4 14.04.20 1.08 264 312 7.98 5.61 40"),
// Mittel mit Zwischenlammzeit ("360 360 ZWZ 257 Tage 355 7.49 5.38 158") und
// Lebensleistung ("LL 7 Nachkommen 1774 7.49 5.38").
//
// Die vier ZW-Zahlen sind dieselben Indizes wie im Herdebuch-Export K09 der
// Schafe (Milch, Fett %, Eiweiss %, MIW = Gesamtzuchtwert, siehe
// herdbookRecords.ts parseK09Sheep) — per Regression gegen die K09-Werte der
// Herde geprüft. Positionen aus den pdf.js-Textkoordinaten (Ursprung oben
// links); die Ahnen-Position aus Spalte und Höhe der Box im Raster, damit
// fehlende Vorfahren keine Lücke rutschen lassen.

export interface PdfItem {
  str: string
  x: number
  y: number
  /** Breite in pt (pdf.js); fehlt sie, gilt die Position als Spaltenmitte. */
  w?: number
}

export interface PdfPageText {
  width: number
  height: number
  items: PdfItem[]
}

export interface CertificateBreedingValues {
  year: number
  reliability: number | null
  idx_milk: number | null
  idx_fat_pct: number | null
  idx_protein_pct: number | null
  gzw: number | null
}

export interface CertificateInfo {
  color: string | null
  maedi_visna: string | null
  ccr5: string | null
  scrapie: string | null
  parasite_resistance: string | null
  offspring_male: number | null
  offspring_female: number | null
  offspring_total: number | null
  offspring_breeding: string | null
}

export interface CertificateScore {
  kind: 'punktierung' | 'lbe'
  date: string
  age_class: string | null
  format: number | null
  fundament: number | null
  udder: number | null
  teats: number | null
  wool: number | null
  /** LBE: Gesamtnote (GN). */
  total: number | null
  defects: string | null
  remarks: string | null
}

export interface CertificatePerformance {
  /** laktation = eigene Laktation der Mutter, mittel = Durchschnitt mit
   * Zwischenlammzeit, lebensleistung = LL, toechter = Töchterleistung eines
   * Vaters je Laktation (lactation_number null = Durchschnitt). */
  kind: 'laktation' | 'mittel' | 'lebensleistung' | 'toechter'
  lactation_number: number | null
  calving_date: string | null
  /** Alter bei der Ablammung "Jahre.Monate", z.B. "1.08". */
  age: string | null
  test_type: string | null
  /** Töchter: Anzahl Laktationen; Lebensleistung: Anzahl Nachkommen. */
  count: number | null
  interval_days: number | null
  days: number | null
  milk_kg: number | null
  fat_pct: number | null
  fat_kg: number | null
  protein_pct: number | null
  protein_kg: number | null
  cell_count: number | null
  persistency: number | null
}

export interface CertificateAnimal {
  /** S = Vater, D = Mutter, SD = Mutter des Vaters usw.; '' = das Tier selbst. */
  position: string
  ear_tag: string
  name: string | null
  birth_date: string | null
  breed_code: string | null
  breeding_values: CertificateBreedingValues | null
  info: CertificateInfo
  scores: CertificateScore[]
  performance: CertificatePerformance[]
}

export interface SmgCertificate {
  subject: CertificateAnimal
  /** Druckdatum unten rechts auf Seite 1 — Stand des Ausweises. */
  document_date: string | null
  inbreeding_pct: number | null
  ancestors: CertificateAnimal[]
}

const POSITIONS = [['S', 'D'], ['SS', 'SD', 'DS', 'DD'], ['SSS', 'SSD', 'SDS', 'SDD', 'DSS', 'DSD', 'DDS', 'DDD']]

const ID_RE = /^(\d{3,4}\.\d{4}|\d{3}\.\d{3}\.\d{3}(?: [A-Z]{2})?|[A-Z]{2}\s?\d{6,14}|\d{6,14}(?: [A-Z]{2})?)$/
const BREED_RE = /^\d+(?:[.,]\d+)?\s?%\s+([A-Z]{2,4})$/
const SHORT_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{2})\b/
const LINE_TOLERANCE = 2

/** Punktierungs-Spalten auf Seite 2, Abstand ab linkem Rand der Box (in
 * allen drei Spalten gleich): Altersklasse, Format, Fundament, Euter,
 * Zitzen, Wolle. */
const SCORE_OFFSETS: [keyof CertificateScore, number][] = [
  ['age_class', 45.4],
  ['format', 59.5],
  ['fundament', 73.7],
  ['udder', 87.8],
  ['teats', 102],
  ['wool', 116.2],
]

const EMPTY_INFO: CertificateInfo = {
  color: null,
  maedi_visna: null,
  ccr5: null,
  scrapie: null,
  parasite_resistance: null,
  offspring_male: null,
  offspring_female: null,
  offspring_total: null,
  offspring_breeding: null,
}

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
  const m = SHORT_DATE_RE.exec(s.trim())
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

const int = (s: string | null | undefined): number | null => {
  if (s == null) return null
  const m = /-?\d+/.exec(s.replace(/['’]/g, ''))
  return m ? Number(m[0]) : null
}
const dec = (s: string | null | undefined): number | null => {
  if (s == null) return null
  const m = /-?\d+(?:[.,]\d+)?/.exec(s.replace(/['’]/g, ''))
  return m ? Number(m[0].replace(',', '.')) : null
}

/** Items einer Zeile (gleiches y ± Toleranz), nach x sortiert. */
function lineAt(items: PdfItem[], y: number, minX = -Infinity, maxX = Infinity): PdfItem[] {
  return items.filter((i) => Math.abs(i.y - y) <= LINE_TOLERANCE && i.x >= minX && i.x < maxX).sort((a, b) => a.x - b.x)
}

/** Zeilen (nach y gruppiert) in einem Rechteck. */
function linesIn(items: PdfItem[], minX: number, maxX: number, minY: number, maxY: number): PdfItem[][] {
  const inside = items.filter((i) => i.x >= minX && i.x < maxX && i.y > minY && i.y < maxY).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: PdfItem[][] = []
  for (const it of inside) {
    const last = lines.at(-1)
    if (last && Math.abs(last[0].y - it.y) <= LINE_TOLERANCE) last.push(it)
    else lines.push([it])
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x))
}

const center = (i: PdfItem) => i.x + (i.w ?? 0) / 2
const joinLine = (line: PdfItem[]) => line.map((i) => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim()

/** Wert rechts neben einer Beschriftung ("Name:" → "SNOOPY HB"); die nächste
 * Beschriftung (endet auf ":") ist kein Wert. */
function valueRightOf(items: PdfItem[], label: string): string | null {
  const l = items.find((i) => i.str.trim() === label)
  if (!l) return null
  const v = lineAt(items, l.y).find((i) => i.x > l.x)
  if (!v || v.str.trim().endsWith(':')) return null
  return v.str.trim() || null
}

/** Items einer Zeile dem jeweils nächstgelegenen Spaltenkopf zuordnen. */
function assignToColumns(line: PdfItem[], headers: { key: string; item: PdfItem }[]): Record<string, string> {
  const row: Record<string, string> = {}
  for (const it of line) {
    const c = center(it)
    const h = headers.reduce((best, cur) => (Math.abs(center(cur.item) - c) < Math.abs(center(best.item) - c) ? cur : best))
    row[h.key] = row[h.key] ? `${row[h.key]} ${it.str.trim()}` : it.str.trim()
  }
  return row
}

/** Tabelle mit Kopfzeile: jede Zeile unterhalb (bis maxY) als Zuordnung
 * Spaltenname → Text, über den nächstgelegenen Spaltenkopf. */
function tableRows(
  items: PdfItem[],
  headers: { key: string; item: PdfItem }[],
  maxY: number,
): Record<string, string>[] {
  if (!headers.length) return []
  const headerY = Math.max(...headers.map((h) => h.item.y))
  const minX = Math.min(...headers.map((h) => h.item.x)) - 15
  const maxX = Math.max(...headers.map((h) => h.item.x + (h.item.w ?? 0))) + 25
  return linesIn(items, minX, maxX, headerY + LINE_TOLERANCE, maxY)
    .map((line) => assignToColumns(line, headers))
    .filter((r) => Object.keys(r).length > 0)
}

function header(items: PdfItem[], text: string, near?: PdfItem, maxDy = 40): PdfItem | undefined {
  return items.find((i) => i.str.trim() === text && (!near || (Math.abs(i.y - near.y) <= maxDy && i.y >= near.y - 2)))
}

function parseBreedingValues(line: PdfItem[]): CertificateBreedingValues | null {
  const m = /ZW:\s*(\d{4})\s+(?:(\d{1,3})\s?%\s+)?(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\s+(\d{2,3})\b/.exec(joinLine(line))
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

const LBE_RE = /^(\d{2}\.\d{2}\.\d{2})\s+(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*(.*)$/
const LACT_RE = /^(\d{1,2})\s+([A-Z]{1,3}\d?)\s+(\d{2}\.\d{2}\.\d{2})\s+(\d+\.\d{2})\s+(\d+)\s+(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)(?:\s+(\d+))?$/
const MEAN_RE = /^(\d+)\s+(\d+)\s+ZWZ\s+(\d+)\s+Tage\s+(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)(?:\s+(\d+))?$/
const LL_RE = /^LL\s+(\d+)\s+Nachkommen\s+(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)$/
const DAUGHTERS_RE = /^(?:(\d)\. Laktation|Durchschnitt)\s+(\d+)\s+(\d+)\s+Tage\s+(\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)(?:\s+(\d+))?$/

const emptyPerformance = (kind: CertificatePerformance['kind']): CertificatePerformance => ({
  kind,
  lactation_number: null,
  calving_date: null,
  age: null,
  test_type: null,
  count: null,
  interval_days: null,
  days: null,
  milk_kg: null,
  fat_pct: null,
  fat_kg: null,
  protein_pct: null,
  protein_kg: null,
  cell_count: null,
  persistency: null,
})

/** Inhalt einer Box auf Seite 2 unterhalb der ZW-Zeile. */
function parseBlockDetails(lines: PdfItem[][], blockX: number, today: string): { scores: CertificateScore[]; performance: CertificatePerformance[] } {
  const scores: CertificateScore[] = []
  const performance: CertificatePerformance[] = []
  let lastLbe: CertificateScore | null = null
  for (const line of lines) {
    const text = joinLine(line)
    if (!text || /^(Punktierungen|Töchterleistungen|Milchleistung)/.test(text) || text.startsWith('ZW:')) {
      lastLbe = null
      continue
    }
    let m: RegExpExecArray | null
    if ((m = LBE_RE.exec(text))) {
      lastLbe = {
        kind: 'lbe',
        date: shortDate(m[1], today)!,
        age_class: null,
        format: Number(m[2]),
        fundament: Number(m[3]),
        udder: Number(m[4]),
        teats: Number(m[5]),
        wool: null,
        total: Number(m[6]),
        defects: null,
        remarks: m[7].trim() || null,
      }
      scores.push(lastLbe)
      continue
    }
    if (SHORT_DATE_RE.test(line[0].str.trim()) && line.length > 1 && /^[A-Z]$/.test(line[1].str.trim())) {
      const score: CertificateScore = {
        kind: 'punktierung',
        date: shortDate(line[0].str, today)!,
        age_class: null,
        format: null,
        fundament: null,
        udder: null,
        teats: null,
        wool: null,
        total: null,
        defects: null,
        remarks: null,
      }
      const defects: string[] = []
      for (const it of line.slice(1)) {
        const off = it.x - blockX
        const col = SCORE_OFFSETS.find(([, o]) => Math.abs(o - off) <= 6)
        if (!col) {
          defects.push(it.str.trim())
          continue
        }
        if (col[0] === 'age_class') score.age_class = it.str.trim()
        else (score[col[0]] as number | null) = int(it.str)
      }
      score.defects = defects.join(' ') || null
      scores.push(score)
      lastLbe = null
      continue
    }
    if ((m = LACT_RE.exec(text))) {
      performance.push({
        ...emptyPerformance('laktation'),
        lactation_number: Number(m[1]),
        test_type: m[2],
        calving_date: shortDate(m[3], today),
        age: m[4],
        days: Number(m[5]),
        milk_kg: Number(m[6]),
        fat_pct: Number(m[7]),
        protein_pct: Number(m[8]),
        cell_count: m[9] ? Number(m[9]) : null,
      })
    } else if ((m = MEAN_RE.exec(text))) {
      performance.push({
        ...emptyPerformance('mittel'),
        interval_days: Number(m[2]),
        days: Number(m[3]),
        milk_kg: Number(m[4]),
        fat_pct: Number(m[5]),
        protein_pct: Number(m[6]),
        cell_count: m[7] ? Number(m[7]) : null,
      })
    } else if ((m = LL_RE.exec(text))) {
      performance.push({
        ...emptyPerformance('lebensleistung'),
        count: Number(m[1]),
        milk_kg: Number(m[2]),
        fat_pct: Number(m[3]),
        protein_pct: Number(m[4]),
      })
    } else if ((m = DAUGHTERS_RE.exec(text))) {
      performance.push({
        ...emptyPerformance('toechter'),
        lactation_number: m[1] ? Number(m[1]) : null,
        count: Number(m[2]),
        days: Number(m[3]),
        milk_kg: Number(m[4]),
        fat_pct: Number(m[5]),
        protein_pct: Number(m[6]),
        cell_count: m[7] ? Number(m[7]) : null,
      })
    } else if (lastLbe) {
      // umbrochene LBE-Bemerkung
      lastLbe.remarks = lastLbe.remarks ? `${lastLbe.remarks} ${text}` : text
      continue
    }
    lastLbe = null
  }
  return { scores, performance }
}

/** Seite 1: Tabellen des Tiers selbst. */
function parseSubjectPage(p1: PdfItem[], today: string) {
  const info: CertificateInfo = {
    ...EMPTY_INFO,
    color: valueRightOf(p1, 'Farbe:'),
    maedi_visna: valueRightOf(p1, 'Maedi Visna:'),
    ccr5: valueRightOf(p1, 'CCR5:'),
    scrapie: valueRightOf(p1, 'Scrapie:'),
    parasite_resistance: valueRightOf(p1, 'Parasitenresistenz:'),
  }
  const scores: CertificateScore[] = []
  const performance: CertificatePerformance[] = []
  let breedingValues: CertificateBreedingValues | null = null
  const below = (anchor: PdfItem | undefined) => p1.filter((i) => anchor && i.y > anchor.y).sort((a, b) => a.y - b.y)

  // Anzahl Nachkommen
  const male = header(p1, 'Männlich')
  if (male) {
    const heads = ['Männlich', 'Weiblich', 'Total', 'Davon Zucht']
      .map((k) => ({ key: k, item: header(p1, k, male, 3)! }))
      .filter((h) => h.item)
    const [row] = tableRows(p1, heads, male.y + 16)
    if (row) {
      info.offspring_male = int(row['Männlich'])
      info.offspring_female = int(row['Weiblich'])
      info.offspring_total = int(row['Total'])
      info.offspring_breeding = row['Davon Zucht'] ?? null
    }
  }

  // Punktierungen (bis zur Fehler-Legende)
  const pTitle = header(p1, 'Punktierungen')
  const pDate = pTitle && below(pTitle).find((i) => i.str.trim() === 'Datum')
  if (pDate) {
    const keys: [string, string][] = [
      ['Datum', 'date'], ['AKL', 'age_class'], ['Format', 'format'], ['Fundam.', 'fundament'],
      ['Euter', 'udder'], ['Zitzen', 'teats'], ['Wolle', 'wool'], ['Fehler*', 'defects'],
    ]
    const heads = keys.map(([t, k]) => ({ key: k, item: header(p1, t, pDate, 3)! })).filter((h) => h.item)
    const legend = below(pDate).find((i) => /=/.test(i.str))
    for (const r of tableRows(p1, heads, legend?.y ?? pDate.y + 45)) {
      const date = r.date ? (shortDate(r.date, today) ?? longDate(r.date)) : null
      if (!date) continue
      scores.push({
        kind: 'punktierung',
        date,
        age_class: r.age_class ?? null,
        format: int(r.format),
        fundament: int(r.fundament),
        udder: int(r.udder),
        teats: int(r.teats),
        wool: int(r.wool),
        total: null,
        defects: r.defects ?? null,
        remarks: null,
      })
    }
  }

  // LBE: "Format Fund. Euter Zitzen" ist ein einziger Kopf — in vier Spalten teilen.
  const lTitle = header(p1, 'LBE')
  const lDate = lTitle && below(lTitle).find((i) => i.str.trim() === 'Datum')
  if (lDate) {
    const heads: { key: string; item: PdfItem }[] = [
      { key: 'date', item: header(p1, 'Datum', lDate, 3)! },
      { key: 'nr', item: header(p1, 'Nr.', lDate, 3)! },
      { key: 'gn', item: header(p1, 'GN', lDate, 3)! },
      { key: 'defects', item: header(p1, 'Fehler', lDate, 3)! },
      { key: 'remarks', item: header(p1, 'Varia', lDate, 3)! },
    ].filter((h) => h.item)
    const combined = header(p1, 'Format Fund. Euter Zitzen', lDate, 3)
    if (combined) {
      const w = (combined.w ?? 100) / 4
      ;['format', 'fundament', 'udder', 'teats'].forEach((key, i) =>
        heads.push({ key, item: { str: key, x: combined.x + i * w, y: combined.y, w } }),
      )
    }
    const end = header(p1, 'Töchterleistungen nach Laktationen') ?? header(p1, 'Zuchtfamilie')
    for (const r of tableRows(p1, heads, end && end.y > lDate.y ? end.y : lDate.y + 60)) {
      const date = r.date ? (shortDate(r.date, today) ?? longDate(r.date)) : null
      if (!date) continue
      scores.push({
        kind: 'lbe',
        date,
        age_class: null,
        format: int(r.format),
        fundament: int(r.fundament),
        udder: int(r.udder),
        teats: int(r.teats),
        wool: null,
        total: int(r.gn),
        defects: r.defects ?? null,
        remarks: r.remarks ?? null,
      })
    }
  }

  // Eigener Zuchtwert (Tabelle "Zuchtwert": Auswertung, Lakt., B%, Milch kg, Fett %, Eiweiss %, MIW).
  const auswertung = header(p1, 'Auswertung')
  if (auswertung) {
    const keys: [string, string][] = [
      ['Auswertung', 'eval'], ['Lakt.', 'lact'], ['B%', 'rel'], ['Milch kg', 'milk'],
      ['Fett %', 'fat'], ['Eiweiss %', 'protein'], ['MIW', 'miw'],
    ]
    const heads = keys.map(([t, k]) => ({ key: k, item: header(p1, t, auswertung, 3)! })).filter((h) => h.item)
    const end = header(p1, 'Zuchtfamilie')
    const [row] = tableRows(p1, heads, end && end.y > auswertung.y ? end.y - 4 : auswertung.y + 20)
    const year = row?.eval ? int(/(\d{4})/.exec(row.eval)?.[1] ?? (longDate(row.eval) ?? '').slice(0, 4)) : null
    if (row && int(row.miw) != null && year) {
      // Milch/Fett/Eiweiss nur übernehmen, wenn es Indizes (um 100) sind — die
      // Kopfzeile nennt "kg" bzw. "%", das Format ist nicht belegt.
      const idx = (v: string | undefined) => {
        const n = int(v)
        return n != null && n >= 50 && n <= 150 && !/[.,]/.test(v ?? '') ? n : null
      }
      breedingValues = {
        year,
        reliability: int(row.rel),
        idx_milk: idx(row.milk),
        idx_fat_pct: idx(row.fat),
        idx_protein_pct: idx(row.protein),
        gzw: int(row.miw),
      }
    }
  }

  // Töchterleistungen (Laktationen, Tage, Milch kg, Fett %/kg, Eiweiss %/kg, ZZ, Pers.)
  const tTitle = header(p1, 'Töchterleistungen nach Laktationen')
  const lakt = tTitle && below(tTitle).find((i) => i.str.trim() === 'Laktationen')
  if (lakt) {
    const pct = p1.filter((i) => i.str.trim() === '%' && i.y > lakt.y && i.y - lakt.y < 14).sort((a, b) => a.x - b.x)
    const kg = p1.filter((i) => i.str.trim() === 'kg' && i.y > lakt.y && i.y - lakt.y < 14).sort((a, b) => a.x - b.x)
    const heads = [
      { key: 'count', item: lakt },
      { key: 'days', item: header(p1, 'Tage', lakt, 3)! },
      { key: 'milk', item: header(p1, 'Milch kg', lakt, 3)! },
      { key: 'fat_pct', item: pct[0] },
      { key: 'fat_kg', item: kg[0] },
      { key: 'protein_pct', item: pct[1] },
      { key: 'protein_kg', item: kg[1] },
      { key: 'scc', item: header(p1, 'ZZ', lakt, 3)! },
      { key: 'pers', item: header(p1, 'Pers.', lakt, 3)! },
    ].filter((h) => h.item)
    const labels = p1.filter((i) => /^(\d\. Laktation|Durchschnitt)$/.test(i.str.trim()) && i.y > lakt.y)
    for (const label of labels) {
      const values = p1.filter((i) => Math.abs(i.y - label.y) <= LINE_TOLERANCE && i.x > label.x + (label.w ?? 40))
      if (!values.length) continue
      const cells = assignToColumns(values, heads)
      if (int(cells.count) == null) continue
      const nr = /^(\d)\./.exec(label.str.trim())
      performance.push({
        ...emptyPerformance('toechter'),
        lactation_number: nr ? Number(nr[1]) : null,
        count: int(cells.count),
        days: int(cells.days),
        milk_kg: dec(cells.milk),
        fat_pct: dec(cells.fat_pct),
        fat_kg: dec(cells.fat_kg),
        protein_pct: dec(cells.protein_pct),
        protein_kg: dec(cells.protein_kg),
        cell_count: int(cells.scc),
        persistency: int(cells.pers),
      })
    }
  }

  return { info, scores, performance, breedingValues }
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
  const own = parseSubjectPage(p1, today)
  const subject: CertificateAnimal = {
    position: '',
    ear_tag: certificateEarTag(id),
    name: cleanName(valueRightOf(p1, 'Name:') ?? ''),
    birth_date: longDate(valueRightOf(p1, 'Geburtsdatum:') ?? ''),
    breed_code: breed ? (/^([A-Z]{2,4})/.exec(breed)?.[1] ?? null) : null,
    breeding_values: own.breedingValues,
    info: own.info,
    scores: own.scores,
    performance: own.performance,
  }

  // Seite 2: Boxen über die ID-Zeile finden (ID links, Rasse "100 % LAC" auf gleicher Höhe).
  const { width, height, items } = pages[1]
  const colOf = (x: number) => (x < width * 0.335 ? 0 : x < width * 0.665 ? 1 : 2)
  const colBounds = (col: number) => [col === 0 ? -Infinity : width * (col === 1 ? 0.335 : 0.665), col === 0 ? width * 0.335 : col === 1 ? width * 0.665 : Infinity] as const
  const found: { col: number; x: number; y: number; idY: number; zwY: number | null; animal: Omit<CertificateAnimal, 'position' | 'scores' | 'performance'> }[] = []
  for (const it of items) {
    const s = it.str.trim()
    if (!ID_RE.test(s) || certificateEarTag(s) === subject.ear_tag) continue
    const col = colOf(it.x)
    const [colMin, colMax] = colBounds(col)
    const line = lineAt(items, it.y, colMin, colMax)
    const breedItem = line.find((i) => BREED_RE.test(i.str.trim()))
    if (!breedItem) continue
    const dateItem = line.find((i) => i.x > breedItem.x && SHORT_DATE_RE.test(i.str.trim()))
    // Kopfzeile (Name) direkt darüber, ZW-Zeile darunter — beide bündig mit der ID.
    const head = items
      .filter((i) => Math.abs(i.x - it.x) <= 4 && i.y < it.y && it.y - i.y < 20)
      .sort((a, b) => b.y - a.y)[0]
    const zwStart = items
      .filter((i) => Math.abs(i.x - it.x) <= 4 && i.y > it.y && i.y - it.y < 25 && i.str.trim().startsWith('ZW:'))
      .sort((a, b) => a.y - b.y)[0]
    const headLine = head ? lineAt(items, head.y, colMin, colMax) : []
    const resistance = headLine.map((i) => /Parasitenresistenz:\s*(\S+)/.exec(i.str)?.[1]).find(Boolean) ?? null
    found.push({
      col,
      x: it.x,
      y: head?.y ?? it.y,
      idY: it.y,
      zwY: zwStart?.y ?? null,
      animal: {
        ear_tag: certificateEarTag(s),
        name: head ? cleanName(head.str) : null,
        birth_date: dateItem ? shortDate(dateItem.str, today) : null,
        breed_code: BREED_RE.exec(breedItem.str.trim())?.[1] ?? null,
        breeding_values: zwStart ? parseBreedingValues(lineAt(items, zwStart.y, zwStart.x - 1, colMax)) : null,
        info: { ...EMPTY_INFO, parasite_resistance: resistance },
      },
    })
  }
  if (found.length === 0) throw new Error('Keine Vorfahren auf Seite 2 gefunden.')

  // Raster: oberste Box = Oberkante, Seitenende abzüglich Rand = Unterkante.
  const top = Math.min(...found.map((b) => b.y))
  const bottom = height - 12
  const ancestors: CertificateAnimal[] = []
  for (const b of found) {
    const n = POSITIONS[b.col].length
    const slot = Math.min(n - 1, Math.max(0, Math.round((b.y - top) / ((bottom - top) / n))))
    // Inhalt der Box: bis zur nächsten Box derselben Spalte bzw. bis zum Seitenende.
    const next = found.filter((o) => o.col === b.col && o.y > b.y).map((o) => o.y).sort((x, y) => x - y)[0] ?? bottom + 10
    const [colMin, colMax] = colBounds(b.col)
    const details = parseBlockDetails(linesIn(items, colMin, colMax, (b.zwY ?? b.idY) + LINE_TOLERANCE, next - LINE_TOLERANCE), b.x, today)
    ancestors.push({ position: POSITIONS[b.col][slot], ...b.animal, ...details })
  }
  const inbreedingPct = inbreeding ? dec(inbreeding) : null
  return { subject, document_date: footerDate ?? null, inbreeding_pct: inbreedingPct, ancestors }
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
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width * viewport.scale })
    }
    pages.push({ width: viewport.width, height: viewport.height, items })
  }
  return pages
}
