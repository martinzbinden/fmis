import { useEffect, useRef, useState } from 'react'
import { rezip, stagedProgress, type ImportPanelProps } from '@fmis/core/upload'
import type { ImportSession } from '@fmis/core/importSession'
import { importFieldsZips, type ImportSummary } from '../lib/importFields'
import { openFieldsImport } from '../lib/importSession'

/** GELAN-Import von der zentralen Upload-Seite (lib/importDetect.ts): gegen
 * den Serverstand und in einem Stück gespeichert (lib/importSession.ts) —
 * das Gerät holt die Änderungen per Sync. Startet, sobald `active`. */
export default function ImportPanel({ claim, active, onStatus }: ImportPanelProps) {
  const started = useRef(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  useEffect(() => {
    if (!active || started.current) return
    started.current = true
    const progress = stagedProgress(
      [
        { key: 'session', label: 'Serverstand laden', weight: 4 },
        { key: 'import', label: 'Raumdaten abgleichen', weight: 3 },
        { key: 'commit', label: 'Speichern', weight: 1 },
      ],
      onStatus,
    )
    void (async () => {
      let session: ImportSession | null = null
      try {
        const name = claim.files[0].container.split('/').pop() || 'raumdaten.zip'
        const zip = await rezip(name, claim.files)
        session = await openFieldsImport((step, f) => progress('session', f, step))
        progress('import', 0)
        const result = await importFieldsZips([zip], session.pg)
        progress('commit', 0)
        result.changed = await session.commit()
        setSummary(result)
        onStatus({ phase: 'done', fraction: 1 })
      } catch (err) {
        setSummary({
          farmsImported: 0,
          managementUnitsImported: 0,
          fieldDeclarationsImported: 0,
          warnings: [err instanceof Error ? err.message : 'Import fehlgeschlagen'],
        })
        onStatus({ phase: 'error' })
      } finally {
        await session?.close().catch(() => {})
      }
    })()
  }, [active, claim, onStatus])

  if (!summary) return null
  return (
    <div className="rounded bg-brand-50 p-3 text-sm text-brand-900">
      <p>
        {summary.farmsImported} Betriebe, {summary.managementUnitsImported} Bewirtschaftungseinheiten,{' '}
        {summary.fieldDeclarationsImported} Kulturflächen gelesen
        {summary.changed != null ? `, davon ${summary.changed} Einträge neu oder geändert` : ''}.
      </p>
      {summary.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-amber-800">
          {summary.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
