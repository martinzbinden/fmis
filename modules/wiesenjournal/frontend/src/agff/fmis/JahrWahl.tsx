// FMIS: Leiste «Saison ‹ 2026 ›» über den AGFF-Seiten, die nach Jahr arbeiten (siehe jahrWahl.ts).
import { useYear } from '../hooks/useYear'
import { useQuery } from '../hooks/useQuery'
import { gemeinsamerTag, gemeinsamerTagSetzen } from '../lib/ansicht'
import { todayIso } from '../lib/format'
import { jahreZurWahl, tagImJahr } from './jahrWahl'

export default function JahrWahl() {
  const [jahr, setJahr] = useYear()
  const laufend = new Date().getFullYear()
  const { data: saisons } = useQuery((s) => [...new Set(s.rows('parcels').map((p) => p.season_year))], [])
  const jahre = jahreZurWahl(saisons, laufend, jahr)
  const i = jahre.indexOf(jahr)
  const waehlen = (y: number) => {
    gemeinsamerTagSetzen(tagImJahr(gemeinsamerTag(), y, todayIso()))
    setJahr(y)
  }
  const knopf = 'grid min-h-11 min-w-11 place-items-center rounded-lg border border-gray-300 bg-white text-lg disabled:opacity-30'
  return (
    <div className="flex items-center gap-2 px-3 pt-2 print:hidden" data-testid="fmis-jahrwahl">
      <span className="text-sm text-gray-600">Saison</span>
      <button type="button" className={knopf} disabled={i <= 0} onClick={() => waehlen(jahre[i - 1])} aria-label="Früheres Jahr">
        ‹
      </button>
      <select
        value={jahr}
        onChange={(e) => waehlen(Number(e.target.value))}
        aria-label="Saison wählen"
        className="min-h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm font-semibold"
      >
        {jahre.map((y) => (
          <option key={y} value={y}>
            {y}
            {y === laufend ? ' (laufend)' : ''}
          </option>
        ))}
      </select>
      <button type="button" className={knopf} disabled={i >= jahre.length - 1} onClick={() => waehlen(jahre[i + 1])} aria-label="Späteres Jahr">
        ›
      </button>
      {jahr !== laufend && (
        <button type="button" className="min-h-11 rounded-lg px-2 text-sm text-brand-700 underline" onClick={() => waehlen(laufend)}>
          zurück zu {laufend}
        </button>
      )}
    </div>
  )
}
