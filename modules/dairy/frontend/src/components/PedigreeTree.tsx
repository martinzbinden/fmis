import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { animalKey, animalLabel } from '@fmis/core/earTag'
import { SIRE_TRAIT } from '../lib/breedingTraits'
import { isoDate, num } from '../lib/format'
import type { AnimalContext } from '../lib/herdContext'
import { Inbreeding, type PedigreeLink } from '../lib/inbreeding'

export interface PedigreeNode {
  animal_key: string
  ear_tag: string
  sire_key: string | null
  dam_key: string | null
  name: string | null
  breed_code: string | null
  birth_date: string | null
  /** Gesamtzuchtwert (Schafe GZW, Kühe ISET) aus Export oder Leistungsausweis. */
  bv: { value: number; reliability: number | null; label: string } | null
}

export interface PedigreeData {
  pedigreeByKey: Map<string, PedigreeNode>
  herdIdByKey: Map<string, string>
  inbreeding: Inbreeding
}

/** Stammbaum der Instanz inkl. Gesamtzuchtwert je Tier: eigene Tiere aus
 * dem Herdebuch-Export (K09), übrige aus importierten Leistungsausweisen. */
export async function loadPedigreeData(pg: PGlite, herd: Map<string, AnimalContext>, species: 'cattle' | 'sheep'): Promise<PedigreeData> {
  const { trait, label } = SIRE_TRAIT[species]
  const [pedigree, externalBvs] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from pedigree where deleted_at is null'),
    pg.query<{ animal_key: string; value: unknown; reliability: unknown }>(
      'select animal_key, value, reliability from pedigree_breeding_values where deleted_at is null and trait = $1 order by eval_date',
      [trait],
    ),
  ])
  const bvByKey = new Map<string, PedigreeNode['bv']>(
    externalBvs.rows.map((r) => [r.animal_key, { value: num(r.value)!, reliability: num(r.reliability), label }]),
  )
  for (const c of herd.values()) {
    const own = c.breedingValues[trait]
    const key = animalKey(c.animal.ear_tag)
    if (own && key) bvByKey.set(key, { value: own.value, reliability: own.reliability, label })
  }
  const pedigreeByKey = new Map<string, PedigreeNode>(
    pedigree.rows.map((p) => [
      String(p.animal_key),
      {
        animal_key: String(p.animal_key),
        ear_tag: String(p.ear_tag),
        sire_key: (p.sire_key as string) ?? null,
        dam_key: (p.dam_key as string) ?? null,
        name: (p.name as string) ?? null,
        breed_code: (p.breed_code as string) ?? null,
        birth_date: isoDate(p.birth_date),
        bv: bvByKey.get(String(p.animal_key)) ?? null,
      },
    ]),
  )
  return {
    pedigreeByKey,
    herdIdByKey: new Map([...herd.values()].map((c) => [animalKey(c.animal.ear_tag) ?? c.animal.ear_tag, c.animal.id])),
    inbreeding: new Inbreeding(
      new Map<string, PedigreeLink>([...pedigreeByKey.values()].map((p) => [p.animal_key, { sire: p.sire_key, dam: p.dam_key }])),
    ),
  }
}

/** Ziel eines Stammbaum-Tiers: eigene Tiere auf ihre Detailseite, alle
 * übrigen auf die Stammbaum-Ansicht (pages/PedigreeAnimal.tsx). */
export function pedigreeLink(moduleKey: string, herdIdByKey: Map<string, string>, key: string): string {
  const herdId = herdIdByKey.get(key)
  return herdId ? `/${moduleKey}/kuehe/${herdId}` : `/${moduleKey}/stammbaum/${encodeURIComponent(key)}`
}

function PedigreeCell({ node, role, linkFor }: { node: PedigreeNode | undefined; role: string; linkFor: (key: string) => string }) {
  if (!node) {
    return <div className="rounded border border-dashed border-gray-200 p-2 text-xs text-gray-400">{role}: unbekannt</div>
  }
  return (
    <div className="min-w-0 rounded border border-gray-200 p-2 text-xs">
      <div className="text-gray-500">{role}</div>
      <div className="break-words font-medium text-gray-800">
        <Link to={linkFor(node.animal_key)} className="text-brand-700">
          {animalLabel(node)}
        </Link>
      </div>
      <div className="break-all text-gray-500">
        {node.breed_code ?? ''}
        {node.birth_date ? ` · ${node.birth_date.slice(0, 4)}` : ''}
      </div>
      {node.bv && (
        <div className="text-gray-700">
          {node.bv.label} <span className="font-semibold">{node.bv.value}</span>
          {node.bv.reliability != null ? ` (${node.bv.reliability} %)` : ''}
        </div>
      )}
    </div>
  )
}

export default function PedigreeTree({
  rootKey,
  pedigreeByKey,
  linkFor,
}: {
  rootKey: string
  pedigreeByKey: Map<string, PedigreeNode>
  linkFor: (key: string) => string
}) {
  const root = pedigreeByKey.get(rootKey)
  const at = (k: string | null | undefined) => (k ? pedigreeByKey.get(k) : undefined)
  const sire = at(root?.sire_key)
  const dam = at(root?.dam_key)
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-2">
        <PedigreeCell node={sire} role="Vater" linkFor={linkFor} />
        <div className="grid grid-cols-2 gap-2 pl-2">
          <PedigreeCell node={at(sire?.sire_key)} role="Vatersvater" linkFor={linkFor} />
          <PedigreeCell node={at(sire?.dam_key)} role="Vatersmutter" linkFor={linkFor} />
        </div>
      </div>
      <div className="space-y-2">
        <PedigreeCell node={dam} role="Mutter" linkFor={linkFor} />
        <div className="grid grid-cols-2 gap-2 pl-2">
          <PedigreeCell node={at(dam?.sire_key)} role="Muttersvater" linkFor={linkFor} />
          <PedigreeCell node={at(dam?.dam_key)} role="Muttersmutter" linkFor={linkFor} />
        </div>
      </div>
    </div>
  )
}
