import { Link } from 'react-router-dom'
import { ANIMAL_CATEGORY_LABEL } from '../lib/format'
import type { UsageEntry } from '../types'

/** Weide aus Herdengruppen (lib/herdModel.ts) im Tageseditor: abgeleitet,
 * hier nicht änderbar — Änderungen über Herden. */
export default function HerdUsageNote({ entries }: { entries: UsageEntry[] }) {
  if (!entries.length) return null
  return (
    <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">
      <div className="font-medium">Weide aus Herden</div>
      <ul className="text-xs">
        {entries.map((e) => (
          <li key={e.id}>
            {e.animal_count} {ANIMAL_CATEGORY_LABEL[e.animal_category ?? ''] ?? ''} — «{e.animal_group}»{e.day_only ? ' (Tagweide)' : ''}
          </li>
        ))}
      </ul>
      <Link to="../herden" className="text-xs font-medium text-emerald-800 underline">
        Ändern unter Herden →
      </Link>
    </div>
  )
}
