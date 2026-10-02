import type { ReactNode } from 'react'
import { fmtCells } from '../lib/culling'
import { fmtDate } from '../lib/format'
import type { CertificateDetails } from '../lib/certificateData'

const BV_LABEL: Record<string, string> = { idx_milk: 'Milch', idx_fat_pct: 'Fett %', idx_protein_pct: 'Eiweiss %', gzw: 'GZW (MIW)' }
const BV_ORDER = ['gzw', 'idx_milk', 'idx_fat_pct', 'idx_protein_pct']

const n = (v: number | null | undefined, d = 0) =>
  v == null ? '' : v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d })

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-gray-500">
            {head.map((h, i) => (
              <th key={i} className={`whitespace-nowrap px-1.5 py-1 font-normal ${i === 0 ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((c, j) => (
                <td key={j} className={`whitespace-nowrap px-1.5 py-1 tabular-nums ${j === 0 ? 'text-left' : 'text-right'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Angaben aus dem SMG-Abstammungs- und Leistungsausweis (Import als PDF). */
export default function CertificateDetailsView({ details }: { details: CertificateDetails }) {
  const { info, breedingValues, scores, performance } = details
  const lactations = performance.filter((p) => p.kind === 'laktation')
  const mean = performance.find((p) => p.kind === 'mittel')
  const lifetime = performance.find((p) => p.kind === 'lebensleistung')
  const daughters = performance
    .filter((p) => p.kind === 'toechter')
    .sort((a, b) => (a.lactation_number ?? 99) - (b.lactation_number ?? 99))
  const health = info
    ? ([
        ['Maedi Visna', info.maedi_visna],
        ['CCR5', info.ccr5],
        ['Scrapie', info.scrapie],
        ['Parasitenresistenz', info.parasite_resistance],
        ['Farbe', info.color],
      ] as const).filter(([, v]) => v)
    : []
  const bvs = [...breedingValues].sort((a, b) => BV_ORDER.indexOf(a.trait) - BV_ORDER.indexOf(b.trait))
  const anyKg = daughters.some((d) => d.fat_kg != null || d.protein_kg != null)
  const anyPers = daughters.some((d) => d.persistency != null)

  return (
    <div className="space-y-4">
      {(health.length > 0 || info?.offspring_total != null) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {health.map(([label, value]) => (
            <div key={label}>
              <div className="text-xs text-gray-500">{label}</div>
              <div className="text-sm font-medium text-gray-800">{value}</div>
            </div>
          ))}
          {info?.offspring_total != null && (
            <div>
              <div className="text-xs text-gray-500">Nachkommen</div>
              <div className="text-sm font-medium text-gray-800">
                {info.offspring_total} ({info.offspring_male ?? '–'} ♂ / {info.offspring_female ?? '–'} ♀)
                {info.offspring_breeding && <div className="text-xs font-normal text-gray-500">in Zucht: {info.offspring_breeding}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {bvs.length > 0 && (
        <Sub title="Zuchtwerte">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {bvs.map((b) => (
              <span key={b.trait}>
                <span className="text-gray-500">{BV_LABEL[b.trait] ?? b.trait}</span>{' '}
                <span className={b.trait === 'gzw' ? 'font-bold' : 'font-medium'}>{b.value}</span>
              </span>
            ))}
            {bvs[0].reliability != null && <span className="text-gray-500">Sicherheit {bvs[0].reliability} %</span>}
          </div>
        </Sub>
      )}

      {scores.length > 0 && (
        <Sub title="Punktierungen / LBE">
          <Table
            head={['Datum', 'Art', 'AKL', 'Format', 'Fund.', 'Euter', 'Zitzen', 'Wolle', 'GN', 'Fehler / Bemerkungen']}
            rows={scores.map((s) => [
              fmtDate(s.score_date),
              s.kind === 'lbe' ? 'LBE' : 'Punkt.',
              s.age_class ?? '',
              n(s.format),
              n(s.fundament),
              n(s.udder),
              n(s.teats),
              n(s.wool),
              n(s.total),
              <span className="inline-block min-w-[16rem] whitespace-normal text-left">{[s.defects, s.remarks].filter(Boolean).join(' · ')}</span>,
            ])}
          />
        </Sub>
      )}

      {(lactations.length > 0 || mean || lifetime) && (
        <Sub title="Milchleistung">
          <Table
            head={['Lakt.', 'Prüfart', 'Ablammung', 'Alter', 'Tage', 'Milch kg', 'Fett %', 'Eiweiss %', 'Zellzahl']}
            rows={[
              ...lactations.map((l) => [
                String(l.lactation_number ?? ''),
                l.test_type ?? '',
                fmtDate(l.calving_date),
                l.age ?? '',
                n(l.days),
                n(l.milk_kg),
                n(l.fat_pct, 2),
                n(l.protein_pct, 2),
                l.cell_count != null ? fmtCells(l.cell_count) : '',
              ]),
              ...(mean
                ? [[
                    <span className="font-semibold">Mittel</span>,
                    '',
                    mean.interval_days != null ? `ZWZ ${mean.interval_days} T.` : '',
                    '',
                    n(mean.days),
                    n(mean.milk_kg),
                    n(mean.fat_pct, 2),
                    n(mean.protein_pct, 2),
                    mean.cell_count != null ? fmtCells(mean.cell_count) : '',
                  ]]
                : []),
              ...(lifetime
                ? [[
                    <span className="font-semibold">Lebensleistung</span>,
                    '',
                    lifetime.count != null ? `${lifetime.count} Nachkommen` : '',
                    '',
                    '',
                    n(lifetime.milk_kg),
                    n(lifetime.fat_pct, 2),
                    n(lifetime.protein_pct, 2),
                    '',
                  ]]
                : []),
            ]}
          />
        </Sub>
      )}

      {daughters.length > 0 && (
        <Sub title="Töchterleistungen">
          <Table
            head={[
              'Laktation',
              'Anzahl',
              'Tage',
              'Milch kg',
              'Fett %',
              ...(anyKg ? ['Fett kg'] : []),
              'Eiweiss %',
              ...(anyKg ? ['Eiweiss kg'] : []),
              'Zellzahl',
              ...(anyPers ? ['Pers.'] : []),
            ]}
            rows={daughters.map((d) => [
              d.lactation_number != null ? `${d.lactation_number}. Laktation` : <span className="font-semibold">Durchschnitt</span>,
              n(d.count),
              n(d.days),
              n(d.milk_kg),
              n(d.fat_pct, 2),
              ...(anyKg ? [n(d.fat_kg, 1)] : []),
              n(d.protein_pct, 2),
              ...(anyKg ? [n(d.protein_kg, 1)] : []),
              d.cell_count != null ? fmtCells(d.cell_count) : '',
              ...(anyPers ? [n(d.persistency)] : []),
            ])}
          />
        </Sub>
      )}

      {details.document_date && <p className="text-xs text-gray-400">Stand Leistungsausweis {fmtDate(details.document_date)}</p>}
    </div>
  )
}
