// Umschalter «Heute · Raster · Jahr» und Frage nach der Startansicht (Etappe 2). Logik in lib/ansicht.ts.
import { useSyncExternalStore } from 'react'
import { Link } from '../fmis/router'
import {
  ansichtAbonnieren,
  ansichtenReihenfolge,
  ansichtPfad,
  ANSICHTEN,
  gemeinsamerTag,
  startAnsicht,
  startAnsichtSetzen,
  startFrageSchliessen,
  startGefragt,
  type Ansicht,
} from '../lib/ansicht'

export function useStartAnsicht(): Ansicht {
  return useSyncExternalStore(ansichtAbonnieren, startAnsicht)
}
export function useGemeinsamerTag(): string {
  return useSyncExternalStore(ansichtAbonnieren, gemeinsamerTag)
}

/**
 * Drei Ansichten nebeneinander, die aktuelle hervorgehoben; Startansicht zuerst. Erst ab 640 px: am Handy stehen dieselben
 * drei Ansichten schon vorne im Menü unten (ein Tipp), und das Raster beginnt so weiter oben (Befund U2).
 */
export function AnsichtUmschalter({ aktiv }: { aktiv: Ansicht }) {
  const start = useStartAnsicht()
  const tag = useGemeinsamerTag()
  return (
    <nav aria-label="Ansicht" className="hidden shrink-0 rounded-lg border border-gray-400 bg-white p-0.5 sm:inline-flex" data-testid="ansicht-umschalter">
      {ansichtenReihenfolge(start).map((a) => (
        <Link
          key={a.key}
          to={ansichtPfad(a.key, tag)}
          aria-current={a.key === aktiv ? 'page' : undefined}
          data-ansicht={a.key}
          className={`flex min-h-9 items-center gap-1 rounded-md px-2.5 text-sm sm:min-h-7 ${
            a.key === aktiv ? 'bg-brand-700 font-semibold text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          <span aria-hidden>{a.icon}</span>
          {a.label}
        </Link>
      ))}
    </nav>
  )
}

/** Einmal beim ersten Start: welche Ansicht beim Öffnen? (Vorgabe nach Gerät; jederzeit unter «Mehr» änderbar) */
export function StartFrage() {
  const gefragt = useSyncExternalStore(ansichtAbonnieren, startGefragt)
  const start = useStartAnsicht()
  if (gefragt) return null
  return (
    <section className="card border-2 border-brand-300 p-3" aria-labelledby="startfrage-titel" data-testid="startfrage">
      <h2 id="startfrage-titel" className="text-sm font-semibold text-gray-800">
        Mit welcher Ansicht soll das Wiesenjournal starten?
      </h2>
      <p className="mt-0.5 text-xs text-gray-600">Die anderen bleiben mit einem Tipp erreichbar. Ändern unter «Mehr».</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {ANSICHTEN.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => startAnsichtSetzen(a.key)}
            aria-pressed={a.key === start}
            className={`rounded-lg border p-2 text-left text-sm ${a.key === start ? 'border-brand-700 bg-brand-50' : 'border-gray-400 bg-white hover:bg-gray-50'}`}
          >
            <span className="font-semibold text-gray-800">
              <span aria-hidden>{a.icon}</span> {a.label}
              {a.key === start && <span className="ml-1 text-xs font-normal text-brand-800">(jetzt)</span>}
            </span>
            <span className="mt-0.5 block text-xs text-gray-600">{a.text}</span>
          </button>
        ))}
      </div>
      <button type="button" className="mt-2 text-xs text-brand-700 underline" onClick={startFrageSchliessen}>
        So lassen
      </button>
    </section>
  )
}

/** Auswahl unter «Mehr». */
export function StartAnsichtWahl() {
  const start = useStartAnsicht()
  return (
    <fieldset className="card space-y-1 px-4 py-3 text-sm text-gray-700" data-testid="startansicht">
      <legend className="sr-only">Startansicht</legend>
      <div className="font-medium text-gray-800" aria-hidden>
        Startansicht auf diesem Gerät
      </div>
      {ANSICHTEN.map((a) => (
        <label key={a.key} className="flex min-h-10 cursor-pointer items-start gap-2 py-1">
          <input type="radio" name="startansicht" className="mt-1 h-4 w-4" checked={a.key === start} onChange={() => startAnsichtSetzen(a.key)} />
          <span>
            <span className="font-medium text-gray-800">
              <span aria-hidden>{a.icon}</span> {a.label}
            </span>
            <span className="block text-xs text-gray-600">{a.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
