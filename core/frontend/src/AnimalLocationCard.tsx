import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { herdLocator, type AnimalLocation } from './animals'

const fmt = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('de-CH') : 'heute')
const today = () => new Date().toISOString().slice(0, 10)

/** Standort eines Tiers aus den Herdengruppen (Wiesenjournal → Herden):
 * aktuelle Gruppe mit Stall und Weide, darunter der Verlauf. Ohne
 * Wiesenjournal-Modul nichts. */
export default function AnimalLocationCard({ moduleKey, animalId, active = true }: { moduleKey: string; animalId: string; active?: boolean }) {
  const locator = herdLocator()
  const [loc, setLoc] = useState<AnimalLocation | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!locator) return
    let alive = true
    locator.locate(moduleKey, animalId, today()).then(
      (l) => alive && setLoc(l),
      () => alive && setError(true),
    )
    return () => {
      alive = false
    }
  }, [locator, moduleKey, animalId])

  if (!locator || error) return null
  if (!loc) return <div className="rounded-lg bg-white p-4 text-sm text-gray-400 shadow-sm">Standort lädt…</div>

  const cur = loc.current
  // Abgegangene Tiere ohne Herden-Verlauf: nichts zu zeigen
  if (!active && loc.history.length === 0) return null
  return (
    <section className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Standort</h2>
        <Link to={locator.herdsPath} className="text-xs text-brand-700">
          Herden →
        </Link>
      </div>
      {cur ? (
        <div className="text-sm">
          <div className="font-medium text-gray-800">
            Gruppe «{cur.groupName}» <span className="text-xs font-normal text-gray-500">seit {fmt(cur.from)} · {cur.categoryLabel}</span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-gray-50 p-2">
              <span className="block text-gray-500">🏠 Stall</span>
              {cur.stall ? (
                <>
                  <span className="font-medium text-gray-800">{cur.stall.name}</span>
                  <span className="block text-gray-400">seit {fmt(cur.stall.since)}</span>
                </>
              ) : (
                <span className="text-gray-400">kein Stall</span>
              )}
            </div>
            <div className="rounded bg-gray-50 p-2">
              <span className="block text-gray-500">🌿 Weide</span>
              {cur.weide ? (
                <>
                  <span className="font-medium text-gray-800">{cur.weide.name}</span>
                  <span className="block text-gray-400">
                    seit {fmt(cur.weide.since)}
                    {cur.weide.dayOnly ? ' · Tagweide' : ''}
                  </span>
                </>
              ) : (
                <span className="text-gray-400">keine Weide</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          {active ? 'Keiner Herdengruppe zugeteilt — unter Herden → «Bestand klären» zuordnen.' : 'Nicht mehr in einer Herdengruppe.'}
        </p>
      )}
      {loc.history.length > (cur ? 1 : 0) && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer text-gray-500">Verlauf ({loc.history.length} Gruppen-Zeiten)</summary>
          <ul className="mt-1 space-y-1">
            {loc.history.map((h, i) => (
              <li key={`${h.groupId}-${h.from}-${i}`}>
                <span className="font-medium text-gray-700">
                  {fmt(h.from)}–{fmt(h.to)}: «{h.groupName}»
                </span>{' '}
                <span className="text-gray-400">{h.categoryLabel}</span>
                {h.places.length > 0 && (
                  <ul className="ml-3 text-gray-500">
                    {h.places.map((p, j) => (
                      <li key={j}>
                        {p.slot === 'stall' ? '🏠' : '🌿'} {p.name} {fmt(p.from)}–{fmt(p.to)}
                        {p.dayOnly ? ' (Tagweide)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
