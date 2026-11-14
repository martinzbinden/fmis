import { Link } from 'react-router-dom'
import { useAnimalGroup } from '../hooks/useAnimalGroup'
import { groupViewPath } from '../lib/groupViews'

/** Sprung vom Einzeltier in seine Tiergruppe: wechselt in den Punkt «Gruppen» (zuletzt benutzte Ansicht, Karten oder
 * Vergleich), die Gruppe steht dort im Blick und das Tier ist hervorgehoben. */
export default function GroupJump({ moduleKey, animalId, className = '' }: { moduleKey: string; animalId: string; className?: string }) {
  const group = useAnimalGroup(animalId)
  if (!group) return null
  return (
    <Link to={groupViewPath(moduleKey, group.id, animalId)} className={`inline-flex min-h-11 items-center gap-1 rounded-lg border-2 border-brand-700 px-3 text-sm font-semibold text-brand-700 active:bg-brand-50 ${className}`} title={`In die Gruppe «${group.name}» wechseln (zuletzt benutzte Ansicht)`}>
      <span aria-hidden>📊</span> Gruppe «{group.name}» →
    </Link>
  )
}
