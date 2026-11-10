import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { fmtNum } from '@fmis/core/yearSummary'
import { useQuery } from '../hooks/useQuery'
import { DP_RATES, dpCropName } from '../lib/directPayments'
import { farmEstimate, loadDpData } from '../lib/dpData'
import { fmtArea } from '../lib/format'
import { geoAdminUrl } from '../lib/geoAdmin'
import { cropLabel } from '../lib/rotationRules'
import type { FieldDeclaration } from '../types'
import DpBreakdown from './DpBreakdown'

const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('de-CH') : null)

/** Angaben zu einer Parzelle der Karte; Direktzahlungen ausklappbar (nur Betriebsleitung und Büro). */
export default function FieldDetails({ decl, farmName }: { decl: FieldDeclaration; farmName: string | undefined }) {
  const canDz = useHasPermission('fields:dz:read')
  const geoUrl = geoAdminUrl(decl.geometry)
  const crop = cropLabel(dpCropName(decl.kultur_code, decl.kultur_name_de), decl.kultur_code)
  const rows: [string, string | null][] = [
    ['Kultur', `${crop} (${decl.kultur_code})`],
    ['Sorte', decl.sorte],
    ['Fläche', fmtArea(decl.area_a)],
    ['Bäume', decl.baeume ? fmtNum(decl.baeume, 0) : null],
    ['Betrieb', farmName ?? null],
    ['Jahr', String(decl.jahr)],
    ['Saat', fmtDate(decl.start_date)],
    ['Ernte', fmtDate(decl.end_date)],
    ['Notiz', decl.notes],
  ]
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500">{k}</dt>
              <dd className="text-gray-900">{v}</dd>
            </div>
          ))}
      </dl>
      {geoUrl && (
        <a href={geoUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 font-medium text-gray-800 active:bg-gray-50">
          🗺️ In map.geo.admin.ch zeigen ↗
        </a>
      )}
      {canDz && <DpSection decl={decl} />}
    </div>
  )
}

function DpSection({ decl }: { decl: FieldDeclaration }) {
  const hasRates = decl.jahr in DP_RATES
  const { data } = useQuery((pg) => loadDpData(pg, decl.jahr), [decl.jahr])
  const calc = useMemo(() => (data && hasRates ? farmEstimate(data, decl.farm_id, decl.jahr) : null), [data, hasRates, decl.farm_id, decl.jahr])
  const p = calc?.estimate.parcels.find((e) => e.parcel.id === decl.id)

  let summary = '…'
  if (!hasRates) summary = `keine Ansätze für ${decl.jahr}`
  else if (data && !p) summary = 'nicht berechnet'
  else if (p) summary = p.offen ? 'offen' : p.total > 0 ? `≈ ${fmtNum(p.total, 0)} Fr.` : '–'

  const link = `/fields/direktzahlungen?jahr=${decl.jahr}&betrieb=${decl.farm_id}&parzelle=${decl.id}`
  return (
    <details className="rounded-lg border border-gray-200">
      <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-3 font-semibold text-gray-800">
        <span className="mr-auto">💰 Direktzahlungen</span>
        <span className="tabular-nums text-gray-700">{summary}</span>
      </summary>
      <div className="space-y-1 border-t bg-gray-50 px-3 py-2 text-xs text-gray-700">
        {!hasRates ? (
          <p>Der Rechner kennt die Ansätze der Jahre {Object.keys(DP_RATES).join(' und ')}.</p>
        ) : !data ? (
          <p>Lädt…</p>
        ) : !p ? (
          <p>Nur Flächen aus dem Raumdaten-Import (Hauptkultur) zählen für die Direktzahlungen.</p>
        ) : (
          <>
            {p.zoneLabel && <p className="text-gray-500">{p.zoneLabel}</p>}
            <DpBreakdown p={p} />
            {p.q2 > 0 && (
              <p className="text-gray-500">
                Davon Qualitätsstufe II: {fmtNum(p.q2, p.isTree ? 0 : 2)} {p.isTree ? 'Bäume' : 'a'}
              </p>
            )}
            <p className="text-gray-500">Schätzung nach DZV Anhang 7 mit den Angaben zum Betrieb. Massgebend ist die Abrechnung des Kantons.</p>
          </>
        )}
        {hasRates && (
          <Link to={link} className="flex min-h-11 items-center font-medium text-brand-700 underline">
            Betrieb und Angaben unter Direktzahlungen →
          </Link>
        )}
      </div>
    </details>
  )
}
