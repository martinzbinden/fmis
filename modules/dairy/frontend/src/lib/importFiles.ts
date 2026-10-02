// Ein Importfeld für alles: Herdebuch-Export (b<nr>.Y01, .K04, …),
// SMG-Leistungsausweise (PDF) und TVD-Tierbestand (Excel), einzeln oder als
// ZIP (auch verschachtelt, z.B. der ZIP-Download der Zuchtorganisation).
// Die Zuordnung geht nach Dateiname und — bei unbekannter Endung — nach
// Inhalt (Herdebuch-Zeilen beginnen mit der Satzart, z.B. "K04").

import JSZip from 'jszip'

export type ImportKind = 'herdbook' | 'certificate' | 'tvd' | 'ignored'

export interface ImportFile {
  name: string
  data: ArrayBuffer
  kind: ImportKind
  /** Warum eine Datei übergangen wird. */
  reason?: string
}

const HERDBOOK_EXT = /\.([BKY]\d{2})$/i
const RECORD_LINE = /^[BKY]\d{2}/

export function classifyFile(name: string, head: string): { kind: ImportKind; reason?: string } {
  const base = name.split('/').pop() ?? name
  const lower = base.toLowerCase()
  if (base.startsWith('.') || name.includes('__MACOSX/')) return { kind: 'ignored', reason: 'Systemdatei' }
  if (lower.endsWith('.pdf')) return { kind: 'certificate' }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return { kind: 'tvd' }
  if (/^code\.c\d{2}$/i.test(base)) return { kind: 'ignored', reason: 'Codetabelle, wird nicht gebraucht' }
  if (HERDBOOK_EXT.test(base)) return { kind: 'herdbook' }
  if (head.split(/\r?\n/).some((l) => RECORD_LINE.test(l))) return { kind: 'herdbook' }
  return { kind: 'ignored', reason: 'Format nicht erkannt' }
}

async function expand(name: string, data: ArrayBuffer, depth: number): Promise<ImportFile[]> {
  if (name.toLowerCase().endsWith('.zip')) {
    if (depth > 3) return [{ name, data, kind: 'ignored', reason: 'zu tief verschachtelt' }]
    const zip = await JSZip.loadAsync(data)
    const out: ImportFile[] = []
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue
      out.push(...(await expand(entry.name, await entry.async('arraybuffer'), depth + 1)))
    }
    return out
  }
  const head = new TextDecoder('windows-1252').decode(data.slice(0, 2000))
  return [{ name, data, ...classifyFile(name, head) }]
}

export async function expandImportFiles(files: File[]): Promise<ImportFile[]> {
  const out: ImportFile[] = []
  for (const f of files) out.push(...(await expand(f.name, await f.arrayBuffer(), 0)))
  return out
}
