// Zentrale Upload-Seite (frontend/src/pages/Upload.tsx): beliebige Dateien
// und ZIPs (auch verschachtelt) annehmen, auspacken und jedem Modul zeigen.
// Jedes Modul erkennt selbst, welche Dateien es kennt (ModuleImporter.detect),
// und entscheidet dabei auch, zu welcher Instanz sie gehören — z.B.
// Herdebuch-Export der Schafe vs. Kühe nach Ohrmarken. Was kein Modul kennt,
// wird gemeldet und nicht importiert: ein neues Format muss zuerst im Code
// eines Moduls angelernt werden.

import type { ComponentType } from 'react'
import JSZip from 'jszip'

export interface UploadFile {
  /** Pfad inkl. ZIP-Herkunft, z.B. "stammdaten.zip/b2109939.K04". */
  path: string
  /** Dateiname ohne Verzeichnis. */
  name: string
  /** Pfad des innersten ZIPs, '' für einzeln hochgeladene Dateien — Exporte
   * aus mehreren Dateien (Shapefile, Herdebuch) gehören zum selben Container. */
  container: string
  /** Pfad innerhalb des Containers (mit Unterverzeichnissen). */
  inner: string
  data: ArrayBuffer
  /** Die ersten 4 kB als Text (windows-1252), für die Inhaltserkennung. */
  head: string
}

export interface ImportClaim {
  /** Was erkannt wurde, z.B. "Herdebuch-Export Betrieb 2109939". */
  format: string
  files: UploadFile[]
  /** Gehört zum Export, wird aber nicht gebraucht (z.B. Codetabelle). */
  skipped?: { file: UploadFile; reason: string }[]
  /** Zusatz, z.B. "71 Tiere, Lacaune". */
  detail?: string
}

export interface ImportDetection {
  claims: ImportClaim[]
  /** Dateien, die das Modul zwar erkennt, aber nicht übernehmen kann — mit
   * Grund. Andere Module bekommen sie trotzdem noch angeboten. */
  rejected?: { file: UploadFile; reason: string }[]
}

export interface ModuleImporter {
  /** Bekannte Formate, für die Liste auf der Upload-Seite. */
  formats: string[]
  /** Ohne dieses Recht übernimmt das Modul nichts. */
  permission: string
  /** Erkennt, welche der (noch nicht zugeordneten) Dateien dieses Modul
   * übernimmt. Darf nicht werfen und `data` nicht verändern — pdf.js z.B.
   * übernimmt den Puffer, darum immer `data.slice(0)` weitergeben. */
  detect(files: UploadFile[]): Promise<ImportDetection>
  /** Führt den Import einer Zuordnung aus und zeigt das Ergebnis samt
   * allfälliger Rückfragen. Startet erst, wenn `active` true wird — die
   * Upload-Seite lässt Importe nacheinander laufen (zwei gleichzeitige
   * Sitzungen derselben Herde könnten dieselbe Zeile doppelt anlegen). */
  Panel: ComponentType<ImportPanelProps>
}

export type ImportPhase = 'queued' | 'running' | 'input' | 'done' | 'error'

export interface ImportStatus {
  phase: ImportPhase
  /** Aktueller Schritt, z.B. "Serverstand laden". */
  step?: string
  /** Gesamtfortschritt 0..1. */
  fraction?: number
}

export interface ImportPanelProps {
  claim: ImportClaim
  active: boolean
  /** 'input' = wartet auf eine Entscheidung; blockiert die Warteschlange nicht. */
  onStatus: (status: ImportStatus) => void
}

/** Fortschritt über gewichtete Schritte; Zwischenmeldungen höchstens alle
 * 150 ms, damit tausende Datensätze nicht tausende Neuzeichnungen auslösen. */
export function stagedProgress(stages: { key: string; label: string; weight: number }[], onStatus: (s: ImportStatus) => void) {
  const total = stages.reduce((sum, st) => sum + st.weight, 0) || 1
  let last = 0
  return (key: string, fraction = 0, label?: string) => {
    const i = Math.max(0, stages.findIndex((st) => st.key === key))
    const now = performance.now()
    if (fraction > 0 && fraction < 1 && now - last < 150) return
    last = now
    const before = stages.slice(0, i).reduce((sum, st) => sum + st.weight, 0)
    const f = Math.min(1, Math.max(0, fraction))
    onStatus({ phase: 'running', step: label ?? stages[i]?.label, fraction: (before + (stages[i]?.weight ?? 0) * f) / total })
  }
}

const SYSTEM_FILE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/i

/** ZIPs (auch verschachtelt, bis 4 Ebenen) auspacken; Systemdateien und
 * Verzeichnisse fallen weg. */
export async function expandUploads(
  picked: File[],
  /** Nach jeder ausgepackten Datei: Anzahl bisher und aktueller Pfad. */
  onFile?: (count: number, path: string) => void,
): Promise<{ files: UploadFile[]; ignored: { path: string; reason: string }[] }> {
  const files: UploadFile[] = []
  const ignored: { path: string; reason: string }[] = []

  async function add(path: string, container: string, inner: string, data: ArrayBuffer, depth: number) {
    const name = inner.split('/').pop() ?? inner
    if (SYSTEM_FILE.test(inner) || name.startsWith('.')) return
    if (name.toLowerCase().endsWith('.zip')) {
      if (depth >= 4) {
        ignored.push({ path, reason: 'zu tief verschachteltes ZIP' })
        return
      }
      let zip: JSZip
      try {
        zip = await JSZip.loadAsync(data)
      } catch {
        ignored.push({ path, reason: 'ZIP ist beschädigt oder verschlüsselt' })
        return
      }
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue
        await add(`${path}/${entry.name}`, path, entry.name, await entry.async('arraybuffer'), depth + 1)
      }
      return
    }
    const head = new TextDecoder('windows-1252').decode(data.slice(0, 4096))
    files.push({ path, name, container, inner, data, head })
    onFile?.(files.length, path)
  }

  for (const f of picked) await add(f.name, '', f.name, await f.arrayBuffer(), 0)
  return { files, ignored }
}

/** Dateien eines Containers wieder als ZIP — für Importe, die einen ganzen
 * Export als ZIP erwarten (z.B. GELAN-Raumdaten). */
export async function rezip(name: string, files: UploadFile[]): Promise<File> {
  const zip = new JSZip()
  for (const f of files) zip.file(f.inner, f.data.slice(0))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  return new File([blob], name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`, { type: 'application/zip' })
}

export const lowerExt = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')
