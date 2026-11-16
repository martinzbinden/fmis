// Parzellen-Finder (Etappe 1, Befund U1): Leiste mit Suche, Chips und Sortierung, Stern je Parzelle, Liste zum Wählen
// für Auswahllisten (eine oder mehrere Parzellen). Logik in lib/finder.ts.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link } from '../fmis/router'
import { db } from '../db/db'
import { useQuery } from '../hooks/useQuery'
import {
  CHIP_TEXT,
  chipUmschalten,
  finden,
  finderAbonnieren,
  finderDaten,
  finderSetzen,
  finderZustand,
  FINDER_LEER,
  SORT_TEXT,
  sternUmschalten,
  type Chip,
  type FinderZustand,
  type Sortierung,
} from '../lib/finder'
import { kleineAusblenden, kleinStand } from '../lib/klein'
import { fmtNum, PARCEL_CATEGORY_COLOR } from '../lib/format'
import KleinHinweis from './KleinHinweis'
import type { Parcel } from '../types'

const CHIPS: Chip[] = ['fav', 'letzte', 'herde', 'futter', 'acker', 'weide', 'n30', 'ungeschnitten']

/** Gemeinsamer Zustand der Ansichten (Raster, Parzellen, später Heute und Jahresblatt). */
export function useGemeinsamerFinder(): [FinderZustand, (z: Partial<FinderZustand>) => void] {
  return [useSyncExternalStore(finderAbonnieren, finderZustand), finderSetzen]
}

export function useFinderDaten(jahr: number) {
  return useQuery((s) => finderDaten(s, jahr), [jahr]).data
}

/** Suche, Chips, Sortierung und Zähler. Mit `taste` fokussiert «/» die Suche (Desktop). */
export function FinderLeiste({
  zustand,
  onZustand,
  anzahl,
  gesamt,
  taste = false,
  kompakt = false,
  autoFocus = false,
}: {
  zustand: FinderZustand
  onZustand: (z: Partial<FinderZustand>) => void
  anzahl: number
  gesamt: number
  taste?: boolean
  kompakt?: boolean
  autoFocus?: boolean
}) {
  const feld = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!taste) return
    const tasten = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        feld.current?.focus()
      }
    }
    document.addEventListener('keydown', tasten)
    return () => document.removeEventListener('keydown', tasten)
  }, [taste])
  const aktiv = zustand.suche.trim() !== '' || zustand.chips.length > 0
  return (
    <div className="space-y-1.5" data-testid="finder">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden>
            🔍
          </span>
          <input
            ref={feld}
            type="search"
            className="inp min-h-10 w-full pl-8 sm:min-h-9"
            placeholder={taste ? 'Parzelle suchen ( / )' : 'Parzelle suchen'}
            aria-label="Parzelle suchen"
            value={zustand.suche}
            autoFocus={autoFocus}
            onChange={(e) => onZustand({ suche: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-700">
          <span className={kompakt ? 'sr-only' : ''}>Sortieren</span>
          <select className="inp min-h-10 py-1 text-xs sm:min-h-9" aria-label="Sortieren" value={zustand.sort} onChange={(e) => onZustand({ sort: e.target.value as Sortierung })}>
            {(Object.keys(SORT_TEXT) as Sortierung[]).map((k) => (
              <option key={k} value={k}>
                {SORT_TEXT[k]}
              </option>
            ))}
          </select>
        </label>
        {!kompakt && zustand.sort === 'eigen' && (
          <Link to="/parzellen?ordnen=1" className="text-xs text-brand-700 underline" data-testid="reihenfolge-link">
            ↕ ändern
          </Link>
        )}
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]" role="group" aria-label="Filter">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={zustand.chips.includes(c)}
            className={`chip shrink-0 whitespace-nowrap ${zustand.chips.includes(c) ? 'chip-on' : 'chip-off'}`}
            onClick={() => onZustand({ chips: chipUmschalten(zustand.chips, c) })}
          >
            {CHIP_TEXT[c]}
          </button>
        ))}
        <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-gray-700" data-testid="finder-anzahl" aria-live="polite">
          {aktiv ? `${anzahl} von ${gesamt}` : ''}
        </span>
        {aktiv && (
          <button type="button" className="chip chip-off shrink-0" onClick={() => onZustand({ suche: '', chips: [] })}>
            × zurücksetzen
          </button>
        )}
      </div>
    </div>
  )
}

/** Stern: Favorit an/aus (setzt auch «immer zeigen», Entscheid E5). */
export function Stern({ parcel, gross = false, tabbar = true }: { parcel: Parcel; gross?: boolean; tabbar?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={tabbar ? undefined : -1}
      aria-pressed={!!parcel.favorit}
      aria-label={`${parcel.name} als Favorit`}
      title={parcel.favorit ? 'Favorit – antippen zum Entfernen' : 'Als Favorit oben anzeigen'}
      data-stern={parcel.name}
      onClick={(e) => {
        e.stopPropagation()
        sternUmschalten(db(), parcel)
      }}
      className={`flex shrink-0 items-center justify-center rounded-full text-lg leading-none hover:bg-amber-50 ${gross ? 'h-11 w-11' : 'h-9 w-9'} ${
        parcel.favorit ? 'text-[#b45309]' : 'text-gray-500'
      }`}
    >
      {parcel.favorit ? '★' : '☆'}
    </button>
  )
}

/**
 * Parzellen für eine Ansicht oder Auswahl: kleine Parzellen ausblenden (ausser bei einer Suche), dann Finder. `behalten`:
 * Parzellen, die sichtbar bleiben müssen (z.B. schon gewählte).
 */
export function useGefunden(alle: Parcel[], zustand: FinderZustand, jahr: number, behalten: (string | null | undefined)[] = []) {
  const daten = useFinderDaten(jahr)
  const { data: klein } = useQuery((s) => kleinStand(s, jahr), [jahr])
  const [kleineZeigen, setKleineZeigen] = useState(false)
  const suchen = zustand.suche.trim() !== ''
  const k = useMemo(() => kleineAusblenden(alle, klein, kleineZeigen || suchen, behalten), [alle, klein, kleineZeigen, suchen, behalten])
  const ergebnis = useMemo(() => finden(k.sichtbar, zustand, daten), [k, zustand, daten])
  const hinweis = suchen ? null : (
    <KleinHinweis anzahl={k.ausgeblendet.length} grenze={k.grenze_a} zeigen={kleineZeigen} onUmschalten={() => setKleineZeigen((v) => !v)} />
  )
  return { ...ergebnis, gesamt: alle.length, hinweis, daten }
}

/**
 * Liste zum Wählen mit eigenem Finder (Auswahllisten in Dialogen). Einzeln: Tipp wählt. Mehrfach: Häkchen, `gewaehlt`.
 * `nahe`: Distanz in Metern je Parzelle (Herde umziehen), die nächsten stehen dann als Gruppe «In der Nähe» zuoberst.
 */
export function ParzellenListe({
  parcels,
  jahr,
  onWahl,
  gewaehlt,
  onUmschalten,
  nahe,
  zusatz,
  hoehe = 'max-h-[50vh]',
}: {
  parcels: Parcel[]
  jahr: number
  onWahl?: (p: Parcel) => void
  gewaehlt?: string[]
  onUmschalten?: (p: Parcel, an: boolean) => void
  nahe?: Map<string, number>
  zusatz?: (p: Parcel) => ReactNode
  hoehe?: string
}) {
  const [z, setZ] = useState<FinderZustand>(FINDER_LEER)
  const { gruppen, liste, gesamt, hinweis } = useGefunden(parcels, z, jahr, gewaehlt ?? [])
  const mehrfach = !!onUmschalten
  const naheGruppe = nahe && !z.suche.trim() && !z.chips.length ? liste.filter((p) => (nahe.get(p.id) ?? Infinity) <= 500).sort((a, b) => nahe.get(a.id)! - nahe.get(b.id)!) : []
  const alleGruppen = naheGruppe.length ? [{ key: 'nahe', titel: '📍 In der Nähe', parcels: naheGruppe }, ...gruppen] : gruppen
  return (
    <div className="space-y-2" data-testid="parzellen-liste">
      <FinderLeiste zustand={z} onZustand={(n) => setZ((a) => ({ ...a, ...n }))} anzahl={liste.length} gesamt={gesamt} kompakt />
      <div className={`${hoehe} overflow-y-auto rounded-lg ring-1 ring-gray-300`}>
        {alleGruppen.map((g) => (
          <div key={g.key} role="group" aria-label={g.titel}>
            <div className="sticky top-0 z-10 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
              {g.titel} · {g.parcels.length}
            </div>
            <ul className="divide-y">
              {g.parcels.map((p) => {
                const an = gewaehlt?.includes(p.id) ?? false
                const inhalt = (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PARCEL_CATEGORY_COLOR[p.category] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-800">{p.name}</span>
                      <span className="block truncate text-xs text-gray-600">
                        {p.area_a != null ? `${fmtNum(p.area_a, 0)} a` : ''}
                        {p.kultur_name_de ? ` · ${p.kultur_name_de}` : ''}
                      </span>
                    </span>
                    {nahe?.get(p.id) != null && <span className="text-xs text-gray-600">{nahe.get(p.id) === 0 ? 'hier' : `${nahe.get(p.id)} m`}</span>}
                    {zusatz?.(p)}
                  </>
                )
                return (
                  <li key={`${g.key}-${p.id}`} className="flex items-center">
                    {mehrfach ? (
                      <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-brand-50">
                        <input type="checkbox" className="h-5 w-5" checked={an} onChange={(e) => onUmschalten!(p, e.target.checked)} />
                        {inhalt}
                      </label>
                    ) : (
                      <button type="button" className="flex min-h-11 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand-50" onClick={() => onWahl?.(p)} data-wahl={p.name}>
                        {inhalt}
                      </button>
                    )}
                    <Stern parcel={p} />
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {liste.length === 0 && <p className="p-3 text-sm text-gray-600">Keine Parzelle passt.</p>}
      </div>
      {hinweis}
    </div>
  )
}
