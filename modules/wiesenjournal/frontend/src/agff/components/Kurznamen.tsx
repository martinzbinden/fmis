// Kurznamen (Wunsch des Betriebs 16.11.2026): Hinweis, wenn Namen die Fläche enthalten oder zu lang sind; Dialog mit Vorschlag
// und Originalname, einzeln oder alle übernehmen, oder eigene Namen eingeben. Das Original bleibt in name_import.
import { useMemo, useState } from 'react'
import Modal from './Modal'
import { db } from '../db/db'
import { useQuery } from '../hooks/useQuery'
import { useEinstellung } from '../hooks/useEinstellung'
import { fmtNum } from '../lib/format'
import { kurzVorschlaege, umbenennen } from '../lib/kurzname'
import type { Parcel } from '../types'

const AUS_KEY = 'kurznamen_hinweis_aus'

/** Hinweis über Raster und Parzellenliste; verschwindet, sobald nichts mehr zu kürzen ist oder man ihn wegklickt. */
export function KurznamenHinweis({ jahr }: { jahr: number }) {
  const { data: parcels } = useQuery((s) => s.rows('parcels').filter((p) => p.season_year === jahr), [jahr])
  const vorschlaege = useMemo(() => kurzVorschlaege(parcels), [parcels])
  const [aus, setAus] = useEinstellung<number>(AUS_KEY, 0)
  const [offen, setOffen] = useState(false)
  if (!vorschlaege.length && !offen) return null
  return (
    <>
      {vorschlaege.length > 0 && aus !== jahr && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 pl-2 text-xs text-sky-950" data-testid="kurznamen-hinweis">
          <button type="button" className="min-h-9 min-w-0 flex-1 truncate text-left font-medium underline sm:min-h-7" onClick={() => setOffen(true)}>
            ✂️ {vorschlaege.length} lange Parzellennamen: kürzere vorschlagen
          </button>
          <button type="button" className="min-h-9 shrink-0 px-2 text-sky-900 underline sm:min-h-7" onClick={() => setAus(jahr)}>
            nicht mehr zeigen
          </button>
        </div>
      )}
      {offen && <KurznamenDialog parcels={parcels} onClose={() => setOffen(false)} />}
    </>
  )
}

/** Dialog: je Parzelle Original, Vorschlag (änderbar) und Häkchen; «Ausgewählte übernehmen». */
export function KurznamenDialog({ parcels, onClose }: { parcels: Parcel[]; onClose: () => void }) {
  const vorschlaege = useMemo(() => kurzVorschlaege(parcels), [parcels])
  const [namen, setNamen] = useState<Record<string, string>>(() => Object.fromEntries(vorschlaege.map((v) => [v.parcel.id, v.vorschlag])))
  const [an, setAn] = useState<Set<string>>(() => new Set(vorschlaege.map((v) => v.parcel.id)))
  const [fertig, setFertig] = useState<number | null>(null)
  const doppelt = useMemo(() => {
    const gezaehlt = new Map<string, number>()
    const andere = parcels.filter((p) => !an.has(p.id)).map((p) => p.name.trim().toLowerCase())
    for (const n of andere) gezaehlt.set(n, (gezaehlt.get(n) ?? 0) + 1)
    for (const id of an) {
      const n = (namen[id] ?? '').trim().toLowerCase()
      gezaehlt.set(n, (gezaehlt.get(n) ?? 0) + 1)
    }
    return new Set([...gezaehlt].filter(([, k]) => k > 1).map(([n]) => n))
  }, [namen, an, parcels])

  const uebernehmen = (ids: string[]) => {
    const s = db()
    s.batch(() => {
      for (const id of ids) {
        const p = s.get('parcels', id)
        if (p) s.put('parcels', umbenennen(p, namen[id] ?? ''))
      }
    })
    setFertig(ids.length)
  }

  if (fertig != null) {
    return (
      <Modal title="Kürzere Namen" onClose={onClose}>
        <p className="text-sm text-gray-700" role="status">
          {fertig} {fertig === 1 ? 'Name' : 'Namen'} übernommen. Die Namen aus dem Import bleiben gespeichert: Sie stehen im Steckbrief und beim
          Bearbeiten der Parzelle, wo man auch zurückwechseln kann. Die Suche findet beide.
        </p>
        <div className="mt-3 flex justify-end">
          <button type="button" className="btn-primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </Modal>
    )
  }

  const gewaehlt = [...an].filter((id) => (namen[id] ?? '').trim())
  return (
    <Modal title="Kürzere Namen" onClose={onClose} wide dirty={false}>
      <p className="mb-2 text-sm text-gray-700">
        Vorschläge ohne Fläche (sie steht in jeder Liste darunter). Jeden Vorschlag kann man ändern. Der Name aus dem Import bleibt
        gespeichert und wird bei einem neuen Import nachgeführt; der eigene Name bleibt.
      </p>
      {vorschlaege.length === 0 ? (
        <p className="text-sm text-gray-600">Keine Namen zu kürzen.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="btn min-h-9 py-1 sm:min-h-7" onClick={() => setAn(new Set(vorschlaege.map((v) => v.parcel.id)))}>
              Alle wählen
            </button>
            <button type="button" className="btn min-h-9 py-1 sm:min-h-7" onClick={() => setAn(new Set())}>
              Keine
            </button>
            <span className="ml-auto text-xs text-gray-600" aria-live="polite">
              {an.size} von {vorschlaege.length} gewählt
            </span>
          </div>
          <ul className="max-h-[55vh] divide-y overflow-y-auto rounded-lg ring-1 ring-gray-300" data-testid="kurznamen-liste">
            {vorschlaege.map(({ parcel: p }) => {
              const n = namen[p.id] ?? ''
              const istDoppelt = an.has(p.id) && doppelt.has(n.trim().toLowerCase())
              return (
                <li key={p.id} className="flex items-start gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-2 h-5 w-5 shrink-0"
                    checked={an.has(p.id)}
                    aria-label={`${p.name} umbenennen`}
                    onChange={(e) =>
                      setAn((a) => {
                        const b = new Set(a)
                        if (e.target.checked) b.add(p.id)
                        else b.delete(p.id)
                        return b
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-gray-600" title={p.name}>
                      {p.name}
                      {p.area_a != null && !/\d\s*a$/.test(p.name) && ` · ${fmtNum(p.area_a, 0)} a`}
                    </div>
                    <input
                      className={`inp w-full ${istDoppelt ? 'border-amber-600' : ''}`}
                      value={n}
                      aria-label={`Neuer Name für ${p.name}`}
                      data-kurzname={p.name}
                      onChange={(e) => {
                        const v = e.target.value
                        setNamen((m) => ({ ...m, [p.id]: v }))
                        setAn((a) => new Set(a).add(p.id))
                      }}
                    />
                    {istDoppelt && <p className="mt-0.5 text-xs text-amber-800">Diesen Namen gibt es mehrfach.</p>}
                  </div>
                  <button
                    type="button"
                    className="btn mt-0.5 min-h-10 shrink-0 px-2 text-xs sm:min-h-9"
                    disabled={!n.trim()}
                    onClick={() => {
                      uebernehmen([p.id])
                      setFertig(null)
                      setAn((a) => {
                        const b = new Set(a)
                        b.delete(p.id)
                        return b
                      })
                    }}
                  >
                    Übernehmen
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Schliessen
        </button>
        {vorschlaege.length > 0 && (
          <button type="button" className="btn-primary" disabled={!gewaehlt.length} onClick={() => uebernehmen(gewaehlt)} data-testid="kurznamen-uebernehmen">
            {gewaehlt.length === vorschlaege.length ? 'Alle übernehmen' : `${gewaehlt.length} übernehmen`}
          </button>
        )}
      </div>
    </Modal>
  )
}
