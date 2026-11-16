// Parzellen-Steckbrief (Etappe 2, B): «Was lief hier?» in zwei Tipps. Kennzahlen des Jahres, Jahresband, Verlauf; von
// hier zum Tag, ins Raster, auf die Karte oder zum Bearbeiten.
import { useState } from 'react'
import { Link, useNavigate, useParams } from '../fmis/router'
import { Stern } from '../components/Finder'
import { useGemeinsamerTag } from '../components/Ansicht'
import { Feld, Legende } from '../components/Jahresband'
import ParzelleBearbeiten from '../components/ParzelleBearbeiten'
import Maske, { MASKEN_TITEL, type MaskenArt } from '../components/Masken'
import { RueckgaengigToast } from '../components/KuerzelLeiste'
import { db } from '../db/db'
import { useQuery } from '../hooks/useQuery'
import { gemeinsamerTagSetzen, montag } from '../lib/ansicht'
import { fmtDate, fmtNum, PARCEL_CATEGORY_LABEL, todayIso } from '../lib/format'
import { jahresband, vorTagen } from '../lib/jahresband'
import { loadJournalRows } from '../lib/journal'
import { useRegen } from '../hooks/useRegen'
import { fmtRegen, regenAusStore, REGEN_QUELLE } from '../lib/regen'

export default function SteckbriefPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const tag = useGemeinsamerTag()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [maske, setMaske] = useState<MaskenArt | null>(null)
  const [toast, setToast] = useState<{ text: string; rueck: () => void; n: number } | null>(null)
  const { data } = useQuery(
    (s) => {
      const p = s.get('parcels', id)
      if (!p) return null
      const band = jahresband(s, p.season_year, [p])
      const verlauf = loadJournalRows(s, p.season_year).rows.filter((r) => r.parcel.id === p.id)
      // Regen (für den ganzen Betrieb): seit der letzten Nutzung bzw. Düngung, und nach jeder Düngung im Verlauf
      const regen = regenAusStore(s)
      return { p, band, verlauf, regen }
    },
    [id],
  )
  useRegen(data?.p.season_year ?? new Date().getFullYear())
  if (!data) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Parzelle nicht gefunden. <Link to="/parzellen" className="text-brand-700 underline">Zu den Parzellen</Link>
      </div>
    )
  }
  const { p, band, verlauf, regen } = data
  const heute = todayIso()
  const regenSeit = (d: string | undefined) => (regen && d ? <span className="font-normal text-gray-600"> · Regen seither: {regen.nach(d, heute)}</span> : null)
  const regenNachGabe = (d: string) => {
    if (!regen) return null
    const am = regen.am(d)
    return `Regen ${am != null ? `${fmtRegen(am)} mm` : '–'} am Tag, ${regen.nach(d, regen.plus(d, 3))} in den 3 Tagen danach`
  }
  const k = band.kennzahlen.get(p.id)!
  const wochen = band.baender.get(p.id) ?? []
  const aktuell = band.wochen.indexOf(montag(tag))
  const heuteW = band.wochen.indexOf(montag(todayIso()))
  const spalten = { gridTemplateColumns: `repeat(${band.wochen.length}, minmax(0, 1fr))` }
  const zumTag = (d: string) => {
    gemeinsamerTagSetzen(d)
    navigate(`/tag/${d}`)
  }
  const zahlen: [string, string][] = [
    ['Nutzungen', String(k.nutzungen)],
    ['Schnitte', String(k.schnitte)],
    ['Weidetage', String(k.weidetage)],
    ['Düngungen', String(k.duengungen)],
    ['N gesamt', k.n_kg_ha != null ? `${fmtNum(k.n_kg_ha, 0)} kg/ha` : '–'],
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3" data-testid="steckbrief">
      <div className="flex items-start gap-2">
        <button type="button" className="btn h-10 w-10 shrink-0 p-0 text-lg" aria-label="Zurück" onClick={() => navigate(-1)}>
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight text-gray-800 sm:text-xl">{p.name}</h1>
          <p className="text-xs text-gray-600">
            {[p.area_a != null ? `${fmtNum(p.area_a, 0)} a` : null, p.kultur_name_de, PARCEL_CATEGORY_LABEL[p.category], p.season_year].filter(Boolean).join(' · ')}
          </p>
          {p.name_import && <p className="text-xs text-gray-500">Name im Import: {p.name_import}</p>}
        </div>
        <Stern parcel={p} gross />
      </div>

      <section className="card p-3" aria-label="Kennzahlen">
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {zahlen.map(([t, v]) => (
            <div key={t}>
              <dt className="text-xs text-gray-600">{t}</dt>
              <dd className="text-base font-semibold text-gray-800">{v}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-gray-600">Zuletzt genutzt: </dt>
            <dd className="inline font-medium text-gray-800" data-testid="zuletzt-genutzt">
              {k.letzteNutzung ? `${k.letzteNutzung.text}, ${fmtDate(k.letzteNutzung.datum)} (${vorTagen(k.letzteNutzung.datum)})` : '–'}
              {regenSeit(k.letzteNutzung?.datum)}
            </dd>
          </div>
          <div>
            <dt className="inline text-gray-600">Zuletzt gedüngt: </dt>
            <dd className="inline font-medium text-gray-800" data-testid="zuletzt-geduengt">
              {k.letzteDuengung ? `${k.letzteDuengung.text}, ${fmtDate(k.letzteDuengung.datum)} (${vorTagen(k.letzteDuengung.datum)})` : '–'}
              {regenSeit(k.letzteDuengung?.datum)}
            </dd>
          </div>
        </dl>
        {regen && (
          <p className="mt-1 text-xs text-gray-500">
            Regen für den ganzen Betrieb: {REGEN_QUELLE}; von Hand eingetragene Tage (Tagesmeldung) gehen vor.
          </p>
        )}
      </section>

      <section className="card space-y-1 p-3" aria-label="Jahresband">
        <h2 className="text-sm font-semibold text-gray-700">Jahr {p.season_year}</h2>
        <div className="grid h-8" style={spalten} aria-hidden onClick={(e) => {
          const i = Number((e.target as HTMLElement).closest<HTMLElement>('[data-w]')?.dataset.w)
          const d = Number.isInteger(i) ? (wochen[i]?.ersterTag ?? band.wochen[i]) : null
          if (d) zumTag(d)
        }}>
          {wochen.map((w, i) => (
            <Feld key={i} w={w} i={i} aktuell={i === aktuell} heute={i === heuteW} />
          ))}
        </div>
        <Legende />
      </section>

      <section className="card p-3" aria-label="Eintragen">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Eintragen auf {p.name}</h2>
        <div className="grid grid-cols-4 gap-2">
          {(['weide', 'schnitt', 'duengen', 'pflege'] as MaskenArt[]).map((a) => (
            <button key={a} type="button" className="btn min-h-11 px-1 text-sm" onClick={() => setMaske(a)} data-steckbrief-maske={a}>
              {MASKEN_TITEL[a]}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link className="btn" to="/raster" onClick={() => verlauf[0] && gemeinsamerTagSetzen(verlauf[0].date)}>
          📅 Im Raster
        </Link>
        <Link className="btn" to={`/karte?parzelle=${p.id}`}>
          🗺️ Karte
        </Link>
        <Link className="btn" to={`/liste?parzelle=${p.id}`}>
          📋 Journal als Liste
        </Link>
        <button type="button" className="btn" onClick={() => setBearbeiten(true)}>
          ✏️ Bearbeiten
        </button>
      </div>

      <section className="card p-3" aria-label="Verlauf">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">Verlauf {p.season_year}</h2>
        {verlauf.length === 0 ? (
          <p className="text-sm text-gray-600">Noch keine Einträge.</p>
        ) : (
          <ul className="divide-y">
            {verlauf.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <button type="button" className="flex min-h-11 w-full items-baseline gap-3 py-1.5 text-left text-sm hover:bg-brand-50" onClick={() => zumTag(r.date)}>
                  <span className="w-20 shrink-0 text-gray-600">{fmtDate(r.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-gray-800">
                      {r.kind === 'duengung' ? '▲ ' : ''}
                      {r.summary}
                    </span>
                    {r.detail && <span className="block truncate text-xs text-gray-600">{r.detail}</span>}
                    {r.kind === 'duengung' && regen && (
                      <span className="block text-xs text-sky-800" data-testid="regen-verlauf">
                        {regenNachGabe(r.date)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {maske && (
        <Maske
          art={maske}
          datum={tag}
          parcels={db().rows('parcels').filter((x) => x.season_year === p.season_year)}
          vorwahl={[p]}
          onClose={() => setMaske(null)}
          onErfasst={(text, rueck) => setToast((t) => ({ text, rueck, n: (t?.n ?? 0) + 1 }))}
        />
      )}
      {toast && (
        <RueckgaengigToast
          key={toast.n}
          text={toast.text}
          onWeg={() => setToast(null)}
          onRueckgaengig={() => {
            toast.rueck()
            setToast(null)
          }}
        />
      )}
      {bearbeiten && <ParzelleBearbeiten parcel={p} year={p.season_year} onClose={() => setBearbeiten(false)} />}
    </div>
  )
}
