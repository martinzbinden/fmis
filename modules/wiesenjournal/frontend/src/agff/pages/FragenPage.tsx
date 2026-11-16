// Suchen und Fragen (Etappe 6, Skizze B5): ein Suchfeld für Fragen und Parzellen, darunter die vorbereiteten Fragen. Jede
// Antwort ist eine Liste mit Sprung zum Steckbrief, als CSV und gedruckt; Fragen mit Chip lassen sich im Raster (und in
// allen Ansichten mit Finder) als Filter verwenden. Logik in lib/fragen.ts.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from '../fmis/router'
import { useQuery } from '../hooks/useQuery'
import { useYear } from '../hooks/useYear'
import { beantworten, FRAGEN, type FrageKey } from '../lib/fragen'
import { CHIP_TEXT, finderSetzen, passtSuche } from '../lib/finder'
import { downloadCsv } from '../lib/report'
import { PARCEL_CATEGORY_COLOR, fmtNum } from '../lib/format'
import { useRegen } from '../hooks/useRegen'

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Farbe nach Alter (Skizze: «Farbe und Text zeigen, was lange her ist») */
const alterKlasse = (a: number | null | undefined) => (a == null ? 'text-red-800 font-semibold' : a > 120 ? 'text-red-800 font-semibold' : a > 60 ? 'text-amber-800 font-semibold' : 'text-gray-700')

export default function FragenPage() {
  const [year] = useYear()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const key = (params.get('frage') as FrageKey | null) ?? null
  const frage = FRAGEN.find((f) => f.key === key) ?? null
  const [seit, setSeit] = useState(`${year}-05-01`)
  const [suche, setSuche] = useState('')
  const { data: parcels } = useQuery((s) => s.rows('parcels').filter((p) => p.season_year === year), [year])
  const { data: antwort } = useQuery((s) => (frage ? beantworten(s, frage.key, year, { seit }) : null), [frage?.key, year, seit])
  // Regen von graswachstum.ch holen, wenn nötig (Spalten bei Gülle und Düngung, Frage «Wie viel hat es geregnet»)
  useRegen(year)
  const kennzahlen = frage?.key === 'regen'

  const fragen = useMemo(() => (suche.trim() ? FRAGEN.filter((f) => norm(`${f.titel} ${f.text}`).includes(norm(suche.trim()))) : FRAGEN), [suche])
  const treffer = useMemo(() => (suche.trim() ? parcels.filter((p) => passtSuche(p, suche)).slice(0, 12) : []), [suche, parcels])

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3" data-testid="fragen">
      <h1 className="text-xl font-bold text-gray-800 print:text-base">Suchen und Fragen {year}</h1>
      <label className="relative block print:hidden">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden>
          🔍
        </span>
        <input type="search" className="inp min-h-11 w-full pl-8" placeholder="Frage oder Parzelle suchen" aria-label="Frage oder Parzelle suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
      </label>
      {treffer.length > 0 && (
        <section className="card p-2 print:hidden" aria-label="Parzellen">
          <h2 className="px-1 text-xs font-semibold text-gray-600">Parzellen</h2>
          <ul className="divide-y">
            {treffer.map((p) => (
              <li key={p.id}>
                <Link to={`/parzelle/${p.id}`} className="flex min-h-11 items-center gap-2 px-1 text-sm hover:bg-brand-50">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PARCEL_CATEGORY_COLOR[p.category] }} aria-hidden />
                  <span className="font-medium text-gray-800">{p.name}</span>
                  <span className="text-xs text-gray-600">{p.area_a != null ? `${fmtNum(p.area_a, 0)} a` : ''} · Steckbrief</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="space-y-1.5 print:hidden" aria-label="Fragen">
        {fragen.map((f) => (
          <li key={f.key}>
            <button
              type="button"
              aria-pressed={f.key === key}
              data-frage={f.key}
              onClick={() => setParams(f.key === key ? {} : { frage: f.key })}
              className={`card flex w-full flex-col items-start px-3 py-2 text-left hover:bg-brand-50 ${f.key === key ? 'ring-2 ring-brand-700' : ''}`}
            >
              <span className="text-sm font-semibold text-gray-800">{f.titel}</span>
              <span className="text-xs text-gray-600">{f.text}</span>
            </button>
          </li>
        ))}
        {fragen.length === 0 && <li className="text-sm text-gray-600">Keine Frage passt.</li>}
      </ul>

      {frage && antwort && (
        <section className="card space-y-2 p-3 print:shadow-none print:ring-0" aria-labelledby="antwort-titel" data-testid="antwort">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="antwort-titel" className="text-base font-semibold text-gray-800">
              {frage.seit ? frage.titel.replace('…', seit.split('-').reverse().join('.')) : frage.titel}
            </h2>
            {!kennzahlen && (
              <span className="text-sm text-gray-600" aria-live="polite">
                {antwort.zeilen.length} {antwort.zeilen.length === 1 ? 'Zeile' : 'Zeilen'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {frage.seit && (
              <label className="flex items-center gap-1 text-sm text-gray-700">
                seit
                <input type="date" className="inp min-h-10" value={seit} onChange={(e) => e.target.value && setSeit(e.target.value)} />
              </label>
            )}
            <button type="button" className="btn" onClick={() => downloadCsv(`frage-${frage.key}-${year}.csv`, antwort.spalten, antwort.zeilen.map((z) => z.werte))} data-testid="frage-csv">
              ⬇ CSV
            </button>
            <button type="button" className="btn" onClick={() => window.print()}>
              🖨 Drucken
            </button>
            {frage.chip && (
              <button
                type="button"
                className="btn"
                data-testid="frage-chip"
                onClick={() => {
                  finderSetzen({ chips: [frage.chip!], suche: '' })
                  navigate('/raster')
                }}
              >
                Als Chip im Raster: «{CHIP_TEXT[frage.chip]}»
              </button>
            )}
          </div>
          {antwort.zeilen.length === 0 ? (
            <p className="text-sm text-gray-600">
              {kennzahlen
                ? 'Noch keine Regenwerte für diesen Zeitraum. Sie kommen automatisch von graswachstum.ch für den Standort der Parzellen (braucht Parzellen mit Umriss und Internet) oder von Hand aus der Tagesmeldung.'
                : 'Keine Parzelle betroffen.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={kennzahlen ? 'sr-only' : ''}>
                  <tr className="border-b text-left text-xs text-gray-600">
                    {antwort.spalten.map((s, i) => (
                      <th key={i} className="px-2 py-1 font-semibold">
                        {s}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {antwort.zeilen.map((z, i) => (
                    <tr key={i} className="border-b last:border-b-0" data-frage-zeile={z.parcel?.name ?? ''}>
                      {z.werte.map((w, j) => {
                        const istName = z.parcel && w === z.parcel.name
                        const istAlter = typeof w === 'string' && (w.startsWith('vor ') || w === 'noch nie')
                        return (
                          <td key={j} className={`px-2 py-1.5 ${istAlter || (j === 1 && frage.key === 'duengung') ? alterKlasse(z.alter) : ''} ${kennzahlen && j === 0 ? 'font-medium text-gray-800' : ''}`}>
                            {istName ? (
                              <Link to={`/parzelle/${z.parcel!.id}`} className="font-medium text-brand-800 underline">
                                {w}
                              </Link>
                            ) : (
                              (w ?? '–')
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
