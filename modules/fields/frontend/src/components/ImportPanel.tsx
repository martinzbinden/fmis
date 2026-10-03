import { useEffect, useRef, useState } from 'react'
import { rezip, type ImportClaim } from '@fmis/core/upload'
import type { ImportSession } from '@fmis/core/importSession'
import { importFieldsZips, type ImportSummary } from '../lib/importFields'
import { openFieldsImport } from '../lib/importSession'

/** GELAN-Import von der zentralen Upload-Seite (lib/importDetect.ts): gegen
 * den Serverstand und in einem Stück gespeichert (lib/importSession.ts) —
 * das Gerät holt die Änderungen per Sync. Läuft beim Anzeigen los. */
export default function ImportPanel({ claim }: { claim: ImportClaim }) {
  const started = useRef(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      let session: ImportSession | null = null
      try {
        const name = claim.files[0].container.split('/').pop() || 'raumdaten.zip'
        const zip = await rezip(name, claim.files)
        session = await openFieldsImport()
        const result = await importFieldsZips([zip], session.pg)
        result.changed = await session.commit()
        setSummary(result)
      } catch (err) {
        setSummary({
          farmsImported: 0,
          managementUnitsImported: 0,
          fieldDeclarationsImported: 0,
          warnings: [err instanceof Error ? err.message : 'Import fehlgeschlagen'],
        })
      } finally {
        await session?.close().catch(() => {})
      }
    })()
  }, [claim])

  if (!summary) return <p className="text-sm text-gray-500">Importiere…</p>
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
