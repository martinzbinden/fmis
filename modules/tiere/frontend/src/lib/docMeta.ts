// Angaben zu einem Merkblatt aus der Datei vorschlagen (pages/Documents.tsx): Titel, Herausgeber, Ausgabe, Thema und ob
// es ein ausfüllbares Formular ist — bei bekannten Formularen auch welches (FMIS füllt es dann selbst aus).
// suggestMeta ist rein (Tests: docMeta.test.ts), extractMeta liest das PDF (Text mit pdf.js, Formularfelder mit pdf-lib).

export type DocKind = 'merkblatt' | 'formular'

/** Formulare, die FMIS selbst ausfüllt, erkannt an ihren Feldnamen (PDF-Formularfelder). */
export const FORM_TYPES: { key: string; label: string; detect: (fields: Set<string>) => boolean }[] = [
  {
    key: 'begleitdokument_klauentiere',
    label: 'Begleitdokument für Klauentiere (BLV)',
    detect: (f) => f.has('Total Tiere') && f.has('Name in Blockschrift'),
  },
  {
    key: 'tierliste_klauentiere',
    label: 'Tierliste – Beilage zum Begleitdokument (BLV)',
    detect: (f) => f.has('Tierliste_Erstellungsdatum'),
  },
]

export const formLabel = (key: string | null | undefined) => FORM_TYPES.find((t) => t.key === key)?.label ?? null

export interface DocMeta {
  title: string
  source: string
  edition: string
  topic: 'transport' | 'allgemein'
  kind: DocKind
  form_key: string | null
}

export interface PdfFacts {
  filename: string
  info: { Title?: string; Author?: string; Subject?: string; CreationDate?: string }
  /** Textzeilen der ersten Seite mit Schriftgrösse, in Lesereihenfolge */
  lines: { text: string; size: number }[]
  /** Text der ersten Seiten (für Herausgeber, Ausgabe, Thema) */
  text: string
  fields: string[]
}

// Herausgeber, die auf Merkblättern für die Tierhaltung häufig sind: Muster im Text → Kurzname
const PUBLISHERS: [RegExp, string][] = [
  [/Bundesamt für Lebensmittelsicherheit und Veterinärwesen|\bBLV\b|\bOSAV\b|\bUSAV\b/, 'BLV'],
  [/INFORAMA/i, 'INFORAMA'],
  [/AGRIDEA/i, 'AGRIDEA'],
  [/Proviande/i, 'Proviande'],
  [/Identitas|\bAgate\b/, 'Identitas / Agate'],
  [/Schweizer Tierschutz|\bSTS\b/, 'Schweizer Tierschutz STS'],
  [/Beratungs- und Gesundheitsdienst für Kleinwiederkäuer|\bBGK\b/, 'BGK'],
  [/Rindergesundheitsdienst|\bRGD\b/, 'RGD'],
  [/Bio Suisse/i, 'Bio Suisse'],
  [/\bAGFF\b/, 'AGFF'],
  [/Schweizerische Eidgenossenschaft|Confédération suisse|Confederazione Svizzera/, 'Bund'],
]

const JUNK_TITLE = /^(microsoft|untitled|unbenannt|dokument\d*|document\d*|titel|title|vorlage)\b|\.(docx?|indd|pdf|xlsx?)$|^[\w-]+_[\w_-]+$/i
const NOT_TITLE = /^(original|kopie(\s*\d)?|copie|copia|schweizerische eidgenossenschaft|confédération suisse|confederazione svizzera|confederaziun svizra)$/i

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Dateiname ohne Endung, Trennzeichen als Leerzeichen, Sprachkürzel weg. */
export function titleFromFilename(name: string): string {
  return tidy(
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b(de|fr|it)\b$/i, ''),
  ).replace(/^./, (c) => c.toUpperCase())
}

export function suggestMeta(f: PdfFacts): DocMeta {
  const fields = new Set(f.fields)
  const form = FORM_TYPES.find((t) => t.detect(fields))

  // Titel: Dokumentinfo, wenn sie nach einem Titel aussieht; sonst die grösste Schrift der ersten Seite
  let title = tidy(f.info.Title ?? '')
  if (title.length < 5 || JUNK_TITLE.test(title)) {
    const candidates = f.lines.filter((l) => l.text.trim().length >= 4 && !NOT_TITLE.test(l.text.trim()))
    const max = Math.max(0, ...candidates.map((l) => l.size))
    const top = candidates.filter((l) => l.size >= max * 0.95)
    title = tidy(top.slice(0, 3).map((l) => l.text).join(' ')).slice(0, 140)
  }
  if (!title) title = titleFromFilename(f.filename)

  const pub = PUBLISHERS.find(([re]) => re.test(f.text))?.[1]
  const author = tidy(f.info.Author ?? '')
  const source = pub ?? (author && !/^(admin|user|benutzer|microsoft|system|unknown|unbekannt|owner|besitzer)\b/i.test(author) ? author : '')

  // Ausgabe: die neueste «Auflage JJJJ» (alte Auflagen stehen oft unsichtbar im Formular), sonst Erstellungsjahr
  const years = [...f.text.matchAll(/(?:Auflage|Ausgabe|Stand|Version|Édition|Edition|Edizione)\s*:?\s*(?:\d{1,2}[./]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]))
  const created = /^D:(\d{4})/.exec(f.info.CreationDate ?? '')?.[1]
  const edition = years.length ? `Auflage ${Math.max(...years)}` : created ? created : ''

  const topic = /transport|verlad|fahrzeit|begleitdokument|tierverkehr|accompagnement|accompagnamento|trasporto/i.test(`${title} ${f.text}`) ? 'transport' : 'allgemein'
  return { title, source, edition, topic, kind: f.fields.length > 0 ? 'formular' : 'merkblatt', form_key: form?.key ?? null }
}

/** PDF lesen (pdf.js): Dokumentinfo, Formularfelder, Text der ersten Seiten. Bilder: nur der Dateiname. */
export async function extractMeta(file: Blob, filename: string): Promise<DocMeta> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(filename)) return suggestMeta({ filename, info: {}, lines: [], text: '', fields: [] })
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Formularfelder mit pdf-lib: pdf.js findet sie in den BLV-Formularen nicht
  let fields: string[] = []
  try {
    const { PDFDocument } = await import('pdf-lib')
    const lib = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false })
    fields = lib.getForm().getFields().map((f) => f.getName())
  } catch {
    /* kein lesbares Formular */
  }
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: bytes }).promise
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const lines: PdfFacts['lines'] = []
    let text = ''
    for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue
        text += `${it.str}${it.hasEOL ? '\n' : ' '}`
        if (p === 1) lines.push({ text: it.str, size: Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10 })
      }
    }
    return suggestMeta({ filename, info: (meta?.info ?? {}) as PdfFacts['info'], lines, text, fields })
  } finally {
    void doc.cleanup()
  }
}
