// FMIS-Fassung (HERKUNFT.json «lokal») der AGFF-Seite «Mehr»: Einstellungen des Journals ohne Konto, Cloud und
// Sicherung (die hat das FMIS selbst). Links auf Seiten, die es im FMIS gibt.
import { Link } from '../fmis/router'
import { useEinstellung, useEntwurf } from '../hooks/useEinstellung'
import { useState } from 'react'
import { useQuery } from '../hooks/useQuery'
import { useYear } from '../hooks/useYear'
import { kurzVorschlaege } from '../lib/kurzname'
import { KurznamenDialog } from '../components/Kurznamen'
import { StartAnsichtWahl } from '../components/Ansicht'
import { WEIDE_NEU_TAGE_KEY } from '../components/KuerzelLeiste'
import { WEIDE_NEU_TAGE } from '../lib/schnell'
import { KLEIN_KEY, KLEIN_VORGABE, type KleinEinstellung } from '../lib/klein'

function KleineParzellen() {
  const [e, speichern] = useEinstellung<KleinEinstellung>(KLEIN_KEY, KLEIN_VORGABE)
  const [grenze, setGrenze] = useEntwurf(
    e.grenze_a,
    (v) => String(v).replace('.', ','),
    (t) => {
      const v = Number(t.replace(',', '.'))
      return t.trim() && Number.isFinite(v) && v > 0 && v <= 10000 ? v : null
    },
  )
  return (
    <div className="card space-y-1 px-4 py-3 text-sm text-gray-700" data-testid="klein-einstellung">
      <div className="font-medium text-gray-800">Kleine Parzellen</div>
      <label className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={e.an} onChange={(x) => speichern({ ...e, an: x.target.checked })} />
        In Listen ausblenden, unter
        <input
          className="inp w-16 py-1 text-center"
          inputMode="decimal"
          aria-label="Grenze in Aren"
          value={grenze}
          onChange={(x) => {
            setGrenze(x.target.value)
            const v = Number(x.target.value.replace(',', '.'))
            if (x.target.value.trim() && Number.isFinite(v) && v > 0 && v <= 10000) speichern({ ...e, grenze_a: v })
          }}
        />
        a
      </label>
      <p className="text-xs text-gray-600">
        Gilt für Heute, Raster plus, Jahr und Auswahllisten. Die Karte zeigt alles, nichts wird gelöscht. Parzellen mit Einträgen im Jahr
        oder mit einer Herde bleiben sichtbar.
      </p>
    </div>
  )
}

const tageLesen = (t: string) => {
  const v = Number(t)
  return t.trim() && Number.isInteger(v) && v >= 0 && v <= 365 ? v : null
}

function Schnellerfassung() {
  const [tage, speichern] = useEinstellung<number>(WEIDE_NEU_TAGE_KEY, WEIDE_NEU_TAGE)
  const [n, setN] = useEntwurf(tage, String, tageLesen)
  return (
    <div className="card space-y-1 px-4 py-3 text-sm text-gray-700">
      <div className="font-medium text-gray-800">Schnellerfassung im Raster</div>
      <label className="flex flex-wrap items-center gap-2">
        Nach den Tieren fragen, wenn die Parzelle seit
        <input
          className="inp w-16 py-1 text-center"
          inputMode="numeric"
          aria-label="Tage ohne Weide"
          value={n}
          onChange={(e) => {
            setN(e.target.value)
            const v = tageLesen(e.target.value)
            if (v != null) speichern(v)
          }}
        />
        Tagen nicht beweidet wurde.
      </label>
    </div>
  )
}

function KurznamenKarte() {
  const [jahr] = useYear()
  const { data: parcels } = useQuery((s) => s.rows('parcels').filter((p) => p.season_year === jahr), [jahr])
  const n = kurzVorschlaege(parcels).length
  const [offen, setOffen] = useState(false)
  return (
    <div className="card space-y-1 px-4 py-3 text-sm text-gray-700">
      <div className="font-medium text-gray-800">Parzellennamen</div>
      <p className="text-xs text-gray-600">
        {n ? `${n} ${n === 1 ? 'Name enthält' : 'Namen enthalten'} die Fläche oder ${n === 1 ? 'ist' : 'sind'} lang.` : 'Alle Namen sind kurz.'} Der
        Name aus dem Import bleibt gespeichert.
      </p>
      {n > 0 && (
        <button type="button" className="btn" onClick={() => setOffen(true)}>
          ✂️ Kürzere Namen vorschlagen
        </button>
      )}
      {offen && <KurznamenDialog parcels={parcels} onClose={() => setOffen(false)} />}
    </div>
  )
}

const ITEMS = [
  { to: '/raster', label: 'Raster plus (Woche, Monat, Saison)', icon: '🗓️' },
  { to: '/parzellen', label: 'Parzellen', icon: '🌱' },
  { to: '/fragen', label: 'Suchen und Fragen', icon: '🔎' },
  { to: '/druck', label: 'Drucken (AGFF-Formular)', icon: '🖨️' },
  { to: '/liste', label: 'Journal als Liste', icon: '📋' },
  { to: '/auswertung', label: 'Auswertung Nährstoffe', icon: '📊' },
  { to: '/duengerarten', label: 'Düngerarten', icon: '🧪' },
  { to: '/herden', label: 'Herden (Modul Tiere)', icon: '🐄' },
]

export default function MorePage() {
  return (
    <div className="mx-auto max-w-md space-y-3 p-3">
      <h1 className="sr-only">Mehr</h1>
      <div className="card divide-y">
        {ITEMS.map((i) => (
          <Link key={i.to} to={i.to} className="flex min-h-11 items-center gap-3 px-4 py-3 text-gray-800 active:bg-gray-50">
            <span aria-hidden className="text-xl">
              {i.icon}
            </span>
            {i.label}
          </Link>
        ))}
      </div>
      <StartAnsichtWahl />
      <Schnellerfassung />
      <KleineParzellen />
      <KurznamenKarte />
      <p className="px-1 text-xs text-gray-600">
        Seiten Heute, Raster plus, Jahr, Steckbrief, Druck und Fragen aus dem AGFF-Wiesenjournal (EUPL-1.2), verbunden mit den Daten des FMIS.
        Kartengrundlage © swisstopo, Niederschlag MeteoSchweiz über graswachstum.ch.
      </p>
    </div>
  )
}
