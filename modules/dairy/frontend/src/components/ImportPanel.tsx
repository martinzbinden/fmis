import { useEffect, useRef, useState } from 'react'
import { decodeHerdbookFile, parseAdisFiles, importAdisData, type ImportSummary } from '../lib/importAdis'
import type { ImportFile } from '../lib/importFiles'
import { openDairyImport } from '../lib/importSession'
import type { ImportSession } from '@fmis/core/importSession'
import { stagedProgress, type ImportPanelProps } from '@fmis/core/upload'
import { parseTierbestand, importTierbestand } from '../lib/importTvd'
import { inTransaction } from '../db/transaction'
import { fmtDate, todayIso } from '../lib/format'
import { parseSmgCertificate, readPdfText } from '../lib/smgCertificate'
import { speciesOf } from '../lib/species'
import { applyCertificatePlan, planCertificateImport, type CertificateImportResult, type CertificatePlan } from '../lib/importCertificate'

/** Import einer Herde (Instanz) von der zentralen Upload-Seite
 * (lib/importDetect.ts): Herdebuch-Export, TVD-Tierbestand (Excel; bei den
 * Schafen für Jungtiere und Widder, die im SMG-Export fehlen) und
 * SMG-Leistungsausweise (PDF). Reihenfolge: Export, dann TVD (Abgleich über
 * den Ohrmarken-Schlüssel, Kurz- und Langform werden nicht doppelt
 * angelegt), zuletzt Ausweise — so hat der Export-Stammbaum Vorrang und der
 * Ausweis füllt Lücken. Läuft beim Anzeigen los. */
export default function ImportPanel({
  moduleKey,
  files,
  active,
  onStatus,
}: { moduleKey: string; files: ImportFile[] } & Omit<ImportPanelProps, 'claim'>) {
  // Offene Sitzung, solange Leistungsausweise auf einen Entscheid warten.
  const session = useRef<ImportSession | null>(null)
  const started = useRef(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [tvdCount, setTvdCount] = useState<{ read: number; written: number } | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [certificates, setCertificates] = useState<CertificateImportResult[]>([])
  const [pending, setPending] = useState<CertificatePlan[]>([])

  async function closeSession() {
    await session.current?.close().catch(() => {})
    session.current = null
  }

  async function decide(plan: CertificatePlan, overwrite: boolean) {
    const s = session.current
    if (!s) return
    setBusy(true)
    try {
      const result = await inTransaction(s.pg, (tx) => applyCertificatePlan(tx, plan, overwrite))
      await s.commit()
      setCertificates((c) => [...c, result])
      const rest = pending.filter((x) => x !== plan)
      setPending(rest)
      if (rest.length === 0) {
        await closeSession()
        onStatus({ phase: 'done', fraction: 1 })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    const of = (kind: ImportFile['kind']) => files.filter((f) => f.kind === kind)
    const herdbook = of('herdbook')
    const certs = of('certificate')
    const progress = stagedProgress(
      [
        { key: 'session', label: 'Serverstand laden', weight: 4 },
        { key: 'herdbook', label: 'Herdebuch', weight: herdbook.length ? 5 : 0 },
        { key: 'tvd', label: 'TVD-Tierbestand', weight: of('tvd').length ? 1 : 0 },
        { key: 'cert', label: 'Leistungsausweise', weight: certs.length ? 1 + certs.length / 4 : 0 },
        { key: 'commit', label: 'Speichern', weight: 1 },
      ],
      onStatus,
    )
    try {
      // Alles gegen den Serverstand (core/frontend/src/importSession.ts):
      // die lokale Datenbank wird erst über den Sync-Pull aktualisiert.
      const s = await openDairyImport(moduleKey, (step, f) => progress('session', f, step))
      session.current = s
      const db = s.pg
      const nextWarnings: string[] = []

      let herdbookSummary: ImportSummary | null = null
      if (herdbook.length > 0) {
        progress('herdbook', 0, 'Herdebuch lesen')
        const parsed = parseAdisFiles(
          herdbook.map((f) => decodeHerdbookFile(f.name, f.data)),
          speciesOf(moduleKey),
        )
        herdbookSummary = await importAdisData(db, parsed, (done, total) =>
          progress('herdbook', done / total, `Herdebuch: ${done.toLocaleString('de-CH')} von ${total.toLocaleString('de-CH')} Datensätzen`),
        )
        nextWarnings.push(...parsed.warnings)
      }

      const tvd = { read: 0, written: 0 }
      for (const f of of('tvd')) {
        progress('tvd', 0)
        try {
          const animals = await parseTierbestand(new File([f.data], f.name))
          if (animals.length === 0) {
            nextWarnings.push(`${f.name}: keine Tiere erkannt (Spalte «Ohrmarkennummer» fehlt?)`)
            continue
          }
          tvd.read += animals.length
          tvd.written += await inTransaction(db, (tx) => importTierbestand(tx, animals))
        } catch (err) {
          nextWarnings.push(`${f.name}: ${err instanceof Error ? err.message : 'nicht lesbar'}`)
        }
      }

      // Ohne Abweichungen direkt speichern, sonst zuerst nachfragen.
      const results: CertificateImportResult[] = []
      const toDecide: CertificatePlan[] = []
      for (const [i, f] of certs.entries()) {
        progress('cert', i / certs.length, `Leistungsausweis ${i + 1} von ${certs.length}`)
        try {
          const plan = await planCertificateImport(db, parseSmgCertificate(await readPdfText(f.data.slice(0)), todayIso()))
          if (plan.conflicts.length) toDecide.push(plan)
          else results.push(await inTransaction(db, (tx) => applyCertificatePlan(tx, plan, true)))
        } catch (err) {
          nextWarnings.push(`${f.name}: ${err instanceof Error ? err.message : 'nicht lesbar'}`)
        }
      }
      progress('commit', 0)
      await s.commit()
      if (toDecide.length === 0) await closeSession()
      onStatus(toDecide.length ? { phase: 'input', step: 'Rückfrage zu Leistungsausweisen', fraction: 1 } : { phase: 'done', fraction: 1 })
      setSummary(herdbookSummary)
      if (of('tvd').length) setTvdCount(tvd)
      setCertificates(results)
      setPending(toDecide)
      setWarnings(nextWarnings)
    } catch (err) {
      await closeSession()
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
      onStatus({ phase: 'error' })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!active || started.current) return
    started.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div className="space-y-2 text-sm">

      {error && <p className="text-red-600">{error}</p>}
      {summary && (
        <div className="rounded bg-brand-50 p-3 text-brand-900">
          <p>Herdebuch: {summary.animalsImported} Tiere, {summary.milkTestsImported} Milchproben, {summary.lactationsImported} Laktationsdaten gelesen.</p>
          <p>
            Neu oder geändert: {summary.pedigreeWritten} Stammbaum-Einträge, {summary.matingsWritten} Belegungen,{' '}
            {summary.birthsWritten} Geburten ({summary.offspringWritten} Nachkommen), {summary.breedingValuesWritten} Zuchtwerte.
          </p>
          {summary.unmatchedEarTags.length > 0 && (
            <p className="mt-1 text-amber-700">
              {summary.unmatchedEarTags.length} Muttertiere nicht (mehr) im Bestand — ihre Einträge wurden
              übersprungen: {summary.unmatchedEarTags.join(', ')}
            </p>
          )}
        </div>
      )}
      {tvdCount != null && (
        <p className="rounded bg-brand-50 p-3 text-brand-900">TVD-Tierbestand: {tvdCount.read} Tiere gelesen, {tvdCount.written} neu oder ergänzt.</p>
      )}
      {pending.map((plan) => (
        <div key={plan.subject} className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">
            Leistungsausweis {plan.subject}
            {plan.document_date ? ` (Stand ${fmtDate(plan.document_date)})` : ''} weicht von gespeicherten Angaben ab:
          </p>
          {plan.older_than_stored && (
            <p className="font-semibold text-red-700">Achtung: Dieser Ausweis ist älter als bereits gespeicherte Angaben.</p>
          )}
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
            {plan.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(plan, true)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${plan.older_than_stored ? 'border border-amber-400 bg-white' : 'bg-amber-600 text-white'}`}
            >
              Mit Ausweis überschreiben
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(plan, false)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${plan.older_than_stored ? 'bg-amber-600 text-white' : 'border border-amber-400 bg-white'}`}
            >
              Nur Neues ergänzen
            </button>
          </div>
        </div>
      ))}
      {certificates.map((c) => (
        <p key={c.subject} className="rounded bg-brand-50 p-3 text-brand-900">
          Leistungsausweis {c.subject}: {c.written} Einträge neu oder geändert
          {c.skipped ? `, ${c.skipped} abweichende Angaben belassen` : ''}.
        </p>
      ))}
      {warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-700">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
