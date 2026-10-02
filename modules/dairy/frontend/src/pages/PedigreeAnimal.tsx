import { Link, Navigate, useParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalLabel } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { loadHerdContext } from '../lib/herdContext'
import { fmtDate, todayIso } from '../lib/format'
import { fmtInbreeding } from '../lib/inbreeding'
import { hasCertificateDetails, loadCertificateDetails } from '../lib/certificateData'
import { speciesOf } from '../lib/species'
import PedigreeTree, { loadPedigreeData, pedigreeLink } from '../components/PedigreeTree'
import CertificateDetailsView from '../components/CertificateDetails'

async function load(pg: PGlite, key: string, species: 'cattle' | 'sheep') {
  const herd = await loadHerdContext(pg, species, todayIso())
  const [pedigree, certificate] = await Promise.all([loadPedigreeData(pg, herd, species), loadCertificateDetails(pg, key)])
  return { ...pedigree, certificate }
}

/** Tier aus dem Stammbaum, das nicht (mehr) im Bestand ist — z.B. ein
 * Widder oder Vorfahr: Abstammung und Angaben aus dem Leistungsausweis. */
export default function PedigreeAnimal({ moduleKey }: { moduleKey: string }) {
  const { key = '' } = useParams()
  const species = speciesOf(moduleKey)
  const { data, loading } = useQuery((pg) => load(pg, key, species), [key, species])

  if (loading && !data) return <p className="p-4 text-center text-gray-400">Lädt…</p>
  if (!data) return null
  const herdId = data.herdIdByKey.get(key)
  if (herdId) return <Navigate to={`/${moduleKey}/kuehe/${herdId}`} replace />
  const node = data.pedigreeByKey.get(key)
  if (!node) return <p className="p-4 text-center text-gray-500">Tier nicht im Stammbaum.</p>
  const f = data.inbreeding.inbreeding(key)

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24">
      <div>
        <Link to={`/${moduleKey}/kuehe`} className="text-sm text-brand-700">
          ← Tiere
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-800">{animalLabel(node)}</h1>
        <p className="text-sm text-gray-500">
          {node.ear_tag}
          {node.breed_code ? ` · ${node.breed_code}` : ''}
          {node.birth_date ? ` · geb. ${fmtDate(node.birth_date)}` : ''} · nicht im Bestand
        </p>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Abstammung</h2>
        <PedigreeTree rootKey={key} pedigreeByKey={data.pedigreeByKey} linkFor={(k) => pedigreeLink(moduleKey, data.herdIdByKey, k)} />
        <p className="mt-2 text-xs text-gray-500">
          Inzucht {fmtInbreeding(f)} · {data.inbreeding.completeness(key).toLocaleString('de-CH', { maximumFractionDigits: 1 })} vollständige
          Generationen bekannt
        </p>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Leistungsausweis</h2>
        {hasCertificateDetails(data.certificate) ? (
          <CertificateDetailsView details={data.certificate} />
        ) : (
          <p className="text-sm text-gray-400">
            Keine Angaben. Den SMG-Abstammungs- und Leistungsausweis (PDF) unter Tiere → Herdebuch-Export importieren.
          </p>
        )}
      </section>
    </div>
  )
}
