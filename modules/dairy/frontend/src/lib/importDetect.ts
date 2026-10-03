// Zentrale Upload-Seite (core/frontend/src/upload.ts): welche Dateien
// gehören zu dieser Herde? Dasselbe Modul läuft für Kühe und Schafe, darum
// entscheidet der Inhalt:
// - Herdebuch-Export (b<nr>.K04 …, je Betrieb ein Satz): Tiernummern ab
//   Stelle 23 — Schweizer Rinder "CH120…", Schafe "CH113…" u.a.
// - TVD-Tierbestand (Excel mit Spalte «Ohrmarkennummer»): Spalten wie
//   «Erstablammung» bzw. «Erstabkalbung», sonst die Ohrmarken (Rinder
//   CH120…, Schafe kurz "CH" + 8 Ziffern).
// - SMG-Abstammungs- und Leistungsausweis (PDF): immer Schafe.

import { read, utils } from 'xlsx'
import type { ImportClaim, ImportDetection, ModuleImporter, UploadFile } from '@fmis/core/upload'
import { classifyFile, type ImportFile } from './importFiles'
import { isSmgCertificate, readPdfText } from './smgCertificate'
import { speciesOf } from './species'

type Species = 'cattle' | 'sheep'

const RECORD = /^[BKY]\d{2}/

/** Tierart eines Herdebuch-Exports aus den Tiernummern (Stelle 23–36). */
export function herdbookSpecies(texts: string[]): Species | null {
  let cattle = 0
  let sheep = 0
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      if (!RECORD.test(line)) continue
      const id = line.slice(22, 36)
      if (!id.startsWith('CH')) continue
      if (id.startsWith('CH120')) cattle++
      else if (/^CH\d{12}$/.test(id)) sheep++
    }
  }
  if (cattle === 0 && sheep === 0) return null
  return cattle >= sheep ? 'cattle' : 'sheep'
}

/** Tierart einer TVD-Tierliste aus Spaltennamen bzw. Ohrmarken. */
export function tvdSpecies(headers: string[], earTags: string[]): Species | null {
  const h = headers.join(' ').toLowerCase()
  if (h.includes('ablammung')) return 'sheep'
  if (h.includes('abkalbung') || h.includes('kalbung')) return 'cattle'
  const tags = earTags.map((t) => t.replace(/[\s.]/g, '').toUpperCase())
  const cattle = tags.filter((t) => t.startsWith('CH120')).length
  const sheep = tags.filter((t) => /^CH\d{8}$/.test(t) || /^CH1(?!20)\d{11}$/.test(t)).length
  if (cattle === 0 && sheep === 0) return null
  return cattle >= sheep ? 'cattle' : 'sheep'
}

function readTvdList(data: ArrayBuffer): { headers: string[]; earTags: string[] } | null {
  try {
    const wb = read(data.slice(0), { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    // Der TVD-Export deklariert einen falschen Bereich (siehe importTvd.ts):
    // die Zellen direkt lesen statt sheet_to_json.
    const cells = Object.keys(sheet).filter((k) => !k.startsWith('!'))
    const headerCells = cells.filter((k) => utils.decode_cell(k).r === 0)
    const headers = headerCells.map((k) => String(sheet[k].v ?? '').trim())
    const col = headerCells.find((k) => String(sheet[k].v ?? '').trim() === 'Ohrmarkennummer')
    if (!col) return null
    const c = utils.decode_cell(col).c
    const earTags = cells
      .filter((k) => {
        const a = utils.decode_cell(k)
        return a.c === c && a.r > 0
      })
      .map((k) => String(sheet[k].v ?? '').trim())
      .filter(Boolean)
    return { headers, earTags }
  } catch {
    return null
  }
}

const stem = (name: string) => name.split('.')[0].toLowerCase()

type DairyClaim = ImportClaim & { dairyFiles: ImportFile[] }

/** Die Dateien einer Zuordnung mit ihrer Art, für components/ImportPanel.tsx. */
export const dairyFilesOf = (claim: ImportClaim): ImportFile[] => (claim as DairyClaim).dairyFiles ?? []

export function createDairyImporter(moduleKey: string, title: string, Panel: ModuleImporter['Panel']): ModuleImporter {
  const mine = speciesOf(moduleKey)
  const herd = mine === 'sheep' ? 'Schafe' : 'Kühe'

  async function detect(files: UploadFile[]): Promise<ImportDetection> {
    const taken: ImportFile[] = []
    const formats: string[] = []
    const skipped: NonNullable<ImportClaim['skipped']> = []
    const rejected: NonNullable<ImportDetection['rejected']> = []
    const claimed: UploadFile[] = []

    // Herdebuch: je Container und Betrieb (Dateiname b<nr>) ein Satz.
    const groups = new Map<string, UploadFile[]>()
    const codeTables: UploadFile[] = []
    for (const f of files) {
      const { kind } = classifyFile(f.name, f.head)
      if (/^code\.c\d{2}$/i.test(f.name)) codeTables.push(f)
      else if (kind === 'herdbook') {
        const key = `${f.container}|${stem(f.name)}`
        groups.set(key, [...(groups.get(key) ?? []), f])
      }
    }
    const containersWithHerdbook = new Set<string>()
    for (const group of groups.values()) {
      const species = herdbookSpecies(group.map((f) => new TextDecoder('windows-1252').decode(f.data)))
      if (species == null) {
        for (const f of group) rejected.push({ file: f, reason: 'Herdebuch-Datei, aber Tierart nicht erkennbar (keine Tiernummern)' })
        continue
      }
      if (species !== mine) continue
      claimed.push(...group)
      containersWithHerdbook.add(group[0].container)
      for (const f of group) taken.push({ name: f.name, data: f.data, kind: 'herdbook' })
      formats.push(`Herdebuch-Export Betrieb ${stem(group[0].name).replace(/^b/, '')} (${group.length} ${group.length === 1 ? 'Datei' : 'Dateien'})`)
    }
    for (const f of codeTables) {
      if (!containersWithHerdbook.has(f.container)) continue
      claimed.push(f)
      skipped.push({ file: f, reason: 'Codetabelle, wird nicht gebraucht' })
    }

    // TVD-Tierbestand (Excel).
    for (const f of files) {
      if (!/\.xlsx?$/i.test(f.name)) continue
      const list = readTvdList(f.data)
      if (!list) continue
      const species = tvdSpecies(list.headers, list.earTags)
      if (species == null) {
        rejected.push({ file: f, reason: 'TVD-Tierliste, aber Tierart nicht erkennbar' })
        continue
      }
      if (species !== mine) continue
      claimed.push(f)
      taken.push({ name: f.name, data: f.data, kind: 'tvd' })
      formats.push(`TVD-Tierbestand ${f.name} (${list.earTags.length} Tiere)`)
    }

    // SMG-Leistungsausweise (nur Schafe).
    if (mine === 'sheep') {
      let certs = 0
      for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.pdf')) continue
        try {
          if (!isSmgCertificate(await readPdfText(f.data.slice(0)))) continue
        } catch {
          continue
        }
        claimed.push(f)
        taken.push({ name: f.name, data: f.data, kind: 'certificate' })
        certs++
      }
      if (certs) formats.push(certs === 1 ? 'SMG-Leistungsausweis' : `${certs} SMG-Leistungsausweise`)
    }

    if (claimed.length === 0) return { claims: [], rejected }
    // Eine Zuordnung je Herde: Export, TVD und Ausweise laufen in einer
    // Sitzung nacheinander (siehe components/ImportPanel.tsx).
    const claim: DairyClaim = {
      format: formats.join(', '),
      detail: `→ ${title} (${herd})`,
      files: claimed,
      skipped,
      dairyFiles: taken,
    }
    return { claims: [claim], rejected }
  }

  return {
    formats:
      mine === 'sheep'
        ? ['Herdebuch-Export SMG (b<nr>.K04, .Y01 … oder ZIP)', 'TVD-Tierbestand Schafe (Excel)', 'SMG-Abstammungs- und Leistungsausweis (PDF)']
        : ['Herdebuch-Export Rindvieh (b<nr>.K04, .Y01 … oder ZIP)', 'TVD-Tierbestand Rinder (Excel)'],
    permission: `${moduleKey}:animals:write`,
    detect,
    Panel,
  }
}
