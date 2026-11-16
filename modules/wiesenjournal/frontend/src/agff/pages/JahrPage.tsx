// Ansicht «Jahr» (C, Etappe 2 als einfache Fassung; Druck folgt in Etappe 5): je Parzelle ein Jahresband mit den Wochen als
// Feldern, rechts Kennzahlen. Finder, Sterne und der gemeinsame Tag gelten wie im Raster und in «Heute».
import { useMemo } from 'react'
import { Link, useNavigate } from '../fmis/router'
import { AnsichtUmschalter, StartFrage, useGemeinsamerTag } from '../components/Ansicht'
import { FinderLeiste, Stern, useGefunden, useGemeinsamerFinder } from '../components/Finder'
import { useQuery } from '../hooks/useQuery'
import { useYear } from '../hooks/useYear'
import { gemeinsamerTagSetzen, isoWoche, montag } from '../lib/ansicht'
import { fmtDate, fmtNum, PARCEL_CATEGORY_COLOR, todayIso } from '../lib/format'
import { Feld, Legende } from '../components/Jahresband'
import { jahresband, vorTagen, type Kennzahlen, type Woche } from '../lib/jahresband'
import type { Parcel } from '../types'

const MONAT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

export default function JahrPage() {
  const [year] = useYear()
  const navigate = useNavigate()
  const tag = useGemeinsamerTag()
  const { data: parcels } = useQuery((s) => s.rows('parcels').filter((p) => p.season_year === year), [year])
  const [finder, setFinder] = useGemeinsamerFinder()
  const { gruppen, liste, gesamt, hinweis } = useGefunden(parcels, finder, year)
  const { data: band } = useQuery((s) => jahresband(s, year, parcels), [year, parcels])
  const aktuelleWoche = useMemo(() => band.wochen.indexOf(montag(tag)), [band, tag])
  const heuteWoche = band.wochen.indexOf(montag(todayIso()))

  // Tipp auf eine Woche: dorthin springen (Raster zeigt die Woche)
  const zuWoche = (i: number, ziel: '/raster' | '/tag' = '/raster', erster?: string | null) => {
    const d = erster ?? band.wochen[i]
    gemeinsamerTagSetzen(d)
    navigate(ziel === '/tag' ? `/tag/${d}` : '/raster')
  }

  const spalten = { gridTemplateColumns: `repeat(${band.wochen.length}, minmax(0, 1fr))` }
  const monatskopf = band.wochen.map((w, i) => {
    const m = Number(addTage(w, 3).slice(5, 7)) - 1 // Donnerstag bestimmt den Monat der Woche
    const vorher = i > 0 ? Number(addTage(band.wochen[i - 1], 3).slice(5, 7)) - 1 : -1
    return m !== vorher ? MONAT[m] : ''
  })

  return (
    <div className="space-y-3 p-3" data-testid="jahresblatt">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-gray-800 sm:text-xl">Jahr {year}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/druck" className="btn text-sm" data-testid="jahr-drucken">
            🖨 Drucken
          </Link>
          <AnsichtUmschalter aktiv="jahr" />
        </div>
      </div>
      <StartFrage />
      {parcels.length === 0 ? (
        <p className="card p-4 text-sm text-gray-600">Für {year} sind noch keine Parzellen angelegt.</p>
      ) : (
        <>
          <FinderLeiste zustand={finder} onZustand={setFinder} anzahl={liste.length} gesamt={gesamt} taste />
          <Legende />
          <div className="card overflow-hidden">
            {/* Kopf: Monate und Kalenderwochen über dem Band */}
            <div className="border-b bg-gray-50 lg:grid lg:grid-cols-[15rem_1fr_13rem]" aria-hidden>
              <div className="hidden px-3 py-1 text-xs font-semibold text-gray-700 lg:block">Parzelle</div>
              <div className="px-3 lg:px-0">
                <div className="grid text-[11px] text-gray-700" style={spalten}>
                  {monatskopf.map((m, i) => (
                    <span key={i} className="overflow-visible whitespace-nowrap border-l border-gray-300 pl-0.5 first:border-l-0" style={{ borderLeftColor: m ? undefined : 'transparent' }}>
                      {m}
                    </span>
                  ))}
                </div>
                <div className="grid text-[10px] text-gray-500" style={spalten}>
                  {band.wochen.map((w, i) => (
                    <button
                      key={w}
                      type="button"
                      tabIndex={-1}
                      className={`text-center ${i === aktuelleWoche ? 'font-bold text-gray-900' : ''}`}
                      title={`KW ${isoWoche(w)[1]} ab ${fmtDate(w)}: im Raster zeigen`}
                      onClick={() => zuWoche(i)}
                    >
                      {(i + 1) % 4 === 1 || i === aktuelleWoche ? isoWoche(w)[1] : ''}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden px-3 py-1 text-xs font-semibold text-gray-700 lg:block">Nutzungen · zuletzt · N/ha</div>
            </div>
            {gruppen.map((g) => (
              <div key={g.key} role="group" aria-label={g.titel}>
                <div className="border-b bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700" data-gruppe={g.key}>
                  {g.titel} · {g.parcels.length}
                </div>
                {g.parcels.map((p) => (
                  <Zeile key={p.id} p={p} wochen={band.baender.get(p.id) ?? []} k={band.kennzahlen.get(p.id)} spalten={spalten} aktuell={aktuelleWoche} heute={heuteWoche} onWoche={zuWoche} />
                ))}
              </div>
            ))}
            {liste.length === 0 && <p className="p-3 text-sm text-gray-600">Keine Parzelle passt.</p>}
          </div>
          {hinweis}
        </>
      )}
    </div>
  )
}

function addTage(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function Zeile({
  p,
  wochen,
  k,
  spalten,
  aktuell,
  heute,
  onWoche,
}: {
  p: Parcel
  wochen: Woche[]
  k: Kennzahlen | undefined
  spalten: React.CSSProperties
  aktuell: number
  heute: number
  onWoche: (i: number, ziel?: '/raster' | '/tag', erster?: string | null) => void
}) {
  const kurz = k ? [k.nutzungen ? `${k.nutzungen} Nutz.` : '–', k.letzteNutzung ? vorTagen(k.letzteNutzung.datum) : null, k.n_kg_ha != null ? `${fmtNum(k.n_kg_ha, 0)} kg N/ha` : null].filter(Boolean).join(' · ') : ''
  const sr = wochen
    .map((w, i) => (w.text.length || w.weide ? `KW ${i + 1}: ${w.weide ? `Weide ${w.weide} Tage` : ''}${w.text.filter((t) => t !== 'Weide').length ? ` ${w.text.filter((t) => t !== 'Weide').join(', ')}` : ''}` : null))
    .filter(Boolean)
  return (
    <div className="border-b px-3 py-1.5 last:border-b-0 lg:grid lg:grid-cols-[15rem_1fr_13rem] lg:items-center lg:px-0 lg:py-0.5" data-jahr-zeile={p.name}>
      <div className="flex min-w-0 items-center gap-1 lg:pl-1">
        <Stern parcel={p} />
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PARCEL_CATEGORY_COLOR[p.category] }} aria-hidden />
        <Link to={`/parzelle/${p.id}`} className="min-w-0 truncate text-sm font-medium text-gray-800 hover:underline" title={`${p.name}: Steckbrief`}>
          {p.name}
        </Link>
        <span className="ml-auto shrink-0 pl-2 text-xs text-gray-600 lg:hidden">{kurz}</span>
      </div>
      <div className="mt-1 grid h-7 lg:mt-0" style={spalten} aria-hidden onClick={(e) => {
        const i = Number((e.target as HTMLElement).closest<HTMLElement>('[data-w]')?.dataset.w)
        if (Number.isInteger(i)) onWoche(i, '/raster', wochen[i]?.ersterTag)
      }}>
        {wochen.map((w, i) => (
          <Feld key={i} w={w} i={i} aktuell={i === aktuell} heute={i === heute} />
        ))}
      </div>
      <p className="sr-only">{sr.length ? sr.join('; ') : 'keine Einträge'}</p>
      <div className="hidden truncate px-3 text-xs text-gray-700 lg:block" title={k?.letzteDuengung ? `zuletzt gedüngt ${fmtDate(k.letzteDuengung.datum)}: ${k.letzteDuengung.text}` : undefined}>
        {kurz}
      </div>
    </div>
  )
}
