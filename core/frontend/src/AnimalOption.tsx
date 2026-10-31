import type { ReactNode } from 'react'
import { shortEarTag } from './earTag'

export interface AnimalOptionData {
  ear_tag: string
  lauf_nr?: string | null
  name?: string | null
  sex?: string | null
  /** pglite liefert date-Spalten je nach Abfrage als Date */
  birth_date?: string | Date | null
}

const SEX: Record<string, { sign: string; title: string }> = {
  w: { sign: '♀', title: 'weiblich' },
  m: { sign: '♂', title: 'männlich' },
  k: { sign: '⚲', title: 'kastriert' },
}

function shortDate(v: string | Date): string {
  if (v instanceof Date) return `${v.getUTCDate()}.${v.getUTCMonth() + 1}.${v.getUTCFullYear()}`
  const [y, m, d] = String(v).slice(0, 10).split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

/** Eine Zeile in Tier-Auswahllisten (alle Ohrmarken-Eingaben gleich): TVD-Nummer,
 * Laufnummer abgesetzt als Marke, Name, rechts klein Geschlecht und Geburtsdatum.
 * `extra` erscheint ganz rechts (z.B. «schon erfasst»). */
export default function AnimalOption({ animal, extra }: { animal: AnimalOptionData; extra?: ReactNode }) {
  const sex = animal.sex ? SEX[animal.sex] : undefined
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 font-semibold tabular-nums text-gray-900">{shortEarTag(animal.ear_tag)}</span>
      {animal.lauf_nr && <span className="shrink-0 rounded bg-brand-100 px-1.5 text-sm font-bold text-brand-900">{animal.lauf_nr}</span>}
      {animal.name && <span className="min-w-0 truncate text-sm text-gray-700">{animal.name}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-gray-600">
        {sex && (
          <span title={sex.title} aria-label={sex.title}>
            {sex.sign}
          </span>
        )}
        {animal.birth_date && <span>{shortDate(animal.birth_date)}</span>}
        {extra}
      </span>
    </span>
  )
}
