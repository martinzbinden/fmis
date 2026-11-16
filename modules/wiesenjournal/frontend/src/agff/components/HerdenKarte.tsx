// Herden auf der Tageskarte und der Herden-Seite: wo jede Herde ist, Knöpfe Umziehen / Einstallen / Austreiben, neue Herde.
import { useMemo, useState } from 'react'
import Modal from './Modal'
import { db } from '../db/db'
import { ANIMAL_CATEGORIES, ANIMAL_CATEGORY_LABEL, ANIMAL_CATEGORY_LETTER, fmtDate } from '../lib/format'
import { herdeAnlegen, herdeLoeschen, herdenStand, herdenZuruecksetzen, herdeText, ortText, umziehen, type Ziel } from '../lib/herden'
import { inDerNaehe } from '../lib/tageskarte'
import { standort } from '../lib/standort'
import type { AnimalCategory, Herde, HerdenAufenthalt, Parcel } from '../types'
import { kleineAusblenden, kleinStand } from '../lib/klein'
import KleinHinweis from './KleinHinweis'
import { ParzellenListe } from './Finder'

/** Parzellen für die Auswahl in den Dialogen, ohne kleine (mit «zeigen»). */
function useAuswahl(parcels: Parcel[], datum: string, behalten: (string | null | undefined)[] = []) {
  const [zeigen, setZeigen] = useState(false)
  const stand = useMemo(() => kleinStand(db(), Number(datum.slice(0, 4))), [datum])
  const k = kleineAusblenden(parcels, stand, zeigen, behalten)
  return {
    parcels: k.sichtbar,
    hinweis: <KleinHinweis className="mt-1" anzahl={k.ausgeblendet.length} grenze={k.grenze_a} zeigen={zeigen} onUmschalten={() => setZeigen((v) => !v)} />,
  }
}

type Eintrag = { herde: Herde; aufenthalt: HerdenAufenthalt | null }
type Toast = (text: string, rueck: () => void) => void

export default function HerdenKarte({ datum, herden, parcels, onToast }: { datum: string; herden: Eintrag[]; parcels: Parcel[]; onToast: Toast }) {
  const [umzug, setUmzug] = useState<Herde | null>(null)
  const [stall, setStall] = useState<Herde | null>(null)
  const [neu, setNeu] = useState(false)
  const aktiv = herden.filter((h) => h.herde.aktiv)

  function ziehen(h: Herde[], ziel: Ziel, aufBeiden: boolean, text: string) {
    const ids = h.map((x) => x.id)
    const stand = herdenStand(db(), ids)
    umziehen(db(), ids, ziel, datum, aufBeiden)
    onToast(text, () => herdenZuruecksetzen(db(), ids, stand))
  }

  return (
    <section className="card p-3" aria-label="Herden" data-testid="herden">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Herden</h2>
        <button type="button" className="btn ml-auto px-2 py-1 text-xs" onClick={() => setNeu(true)}>
          ＋ Herde
        </button>
      </div>
      {aktiv.length === 0 ? (
        <p className="text-xs text-gray-500">Eine Herde zieht als Ganzes um: ein Tipp auf «Umziehen» füllt die Weidetage im Journal von selbst.</p>
      ) : (
        <ul className="divide-y">
          {aktiv.map(({ herde, aufenthalt }) => (
            <li key={herde.id} className="flex flex-wrap items-center gap-2 py-2" data-herde={herde.name}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800" aria-hidden>
                {ANIMAL_CATEGORY_LETTER[herde.kategorie]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-800">{herdeText(herde)}</span>
                <span className="block truncate text-xs text-gray-600" data-testid="herde-ort">
                  {ortText(db(), aufenthalt, datum)}
                </span>
              </span>
              <span className="flex gap-1">
                <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setUmzug(herde)}>
                  {aufenthalt?.ort === 'stall' ? 'Austreiben' : 'Umziehen'}
                </button>
                {aufenthalt?.ort !== 'stall' && (
                  <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setStall(herde)}>
                    Einstallen
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {umzug && (
        <UmziehenDialog
          herde={umzug}
          andere={aktiv.map((x) => x.herde).filter((x) => x.id !== umzug.id)}
          aktuell={herden.find((x) => x.herde.id === umzug.id)?.aufenthalt ?? null}
          datum={datum}
          parcels={parcels}
          onClose={() => setUmzug(null)}
          onZiel={(mit, p, aufBeiden) => {
            ziehen([umzug, ...mit], { ort: 'weide', parcel_id: p.id }, aufBeiden, `${[umzug, ...mit].map((x) => x.name).join(', ')} → ${p.name}`)
            setUmzug(null)
          }}
        />
      )}
      {stall && (
        <Modal title={`${stall.name} einstallen · ${fmtDate(datum)}`} onClose={() => setStall(null)}>
          <div className="space-y-2" data-testid="einstallen">
            {([
              ['L', 'Mit Laufhof', 'Laufhof auto = L'],
              ['0', 'Ohne Auslauf', 'Laufhof auto = 0'],
            ] as const).map(([w, t, u]) => (
              <button
                key={w}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ring-1 ring-gray-200 hover:bg-brand-50"
                onClick={() => {
                  ziehen([stall], { ort: 'stall', auslauf: w }, false, `${stall.name} im Stall (${t.toLowerCase()})`)
                  setStall(null)
                }}
              >
                <span className="w-6 text-center text-lg font-bold text-brand-800">{w}</span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="block text-xs text-gray-500">{u}, ab {fmtDate(datum)}</span>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {neu && (
        <HerdeDialog
          datum={datum}
          parcels={parcels}
          onClose={() => setNeu(false)}
          onFertig={(name, id) => {
            setNeu(false)
            onToast(`Herde ${name} angelegt`, () => herdeLoeschen(db(), id))
          }}
        />
      )}
    </section>
  )
}

function UmziehenDialog({
  herde,
  andere,
  aktuell,
  datum,
  parcels,
  onClose,
  onZiel,
}: {
  herde: Herde
  andere: Herde[]
  aktuell: HerdenAufenthalt | null
  datum: string
  parcels: Parcel[]
  onClose: () => void
  onZiel: (mit: Herde[], p: Parcel, aufBeiden: boolean) => void
}) {
  const [mit, setMit] = useState<string[]>([])
  const [aufBeiden, setAufBeiden] = useState(false)
  // nächste Parzellen zuerst («In der Nähe»), wenn ein frischer Standort bekannt ist
  const ziele = useMemo(() => parcels.filter((p) => p.id !== aktuell?.parcel_id), [parcels, aktuell])
  const nahe = useMemo(() => {
    const fix = standort().fix
    return fix && Date.now() - fix.zeit < 10 * 60000 ? new Map(inDerNaehe(ziele, fix.lat, fix.lng, 2000, 99).map((x) => [x.parcel.id, x.m])) : undefined
  }, [ziele])
  return (
    <Modal title={`${herde.name} ${aktuell?.ort === 'stall' ? 'austreiben' : 'umziehen'} · ${fmtDate(datum)}`} onClose={onClose}>
      <div className="space-y-3 text-sm" data-testid="umziehen">
        {andere.length > 0 && (
          <div>
            <span className="mb-1 block text-xs text-gray-600">Zieht mit</span>
            <div className="flex flex-wrap gap-1">
              {andere.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className={`chip ${mit.includes(h.id) ? 'chip-on' : 'chip-off'}`}
                  onClick={() => setMit((m) => (m.includes(h.id) ? m.filter((x) => x !== h.id) : [...m, h.id]))}
                >
                  {h.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {aktuell && (
          <label className="flex items-center gap-2 text-gray-700">
            <input type="checkbox" checked={aufBeiden} onChange={(e) => setAufBeiden(e.target.checked)} />
            Umzug im Lauf des Tages (heute auf beiden)
          </label>
        )}
        {/* Finder wie überall (Etappe 1) */}
        <ParzellenListe parcels={ziele} jahr={Number(datum.slice(0, 4))} nahe={nahe} onWahl={(p) => onZiel(andere.filter((h) => mit.includes(h.id)), p, aufBeiden)} />
      </div>
    </Modal>
  )
}

export function HerdeDialog({ datum, parcels, onClose, onFertig }: { datum: string; parcels: Parcel[]; onClose: () => void; onFertig: (name: string, id: string) => void }) {
  const [name, setName] = useState('')
  const [kategorie, setKategorie] = useState<AnimalCategory>('kuehe')
  const [anzahl, setAnzahl] = useState('')
  const [start, setStart] = useState('stall:L')
  const [von, setVon] = useState(datum)
  const auswahl = useAuswahl(parcels, datum, [start])
  const ok = name.trim() !== '' && !!von
  function speichern() {
    if (!ok) return
    const ziel: Ziel = start.startsWith('stall:') ? { ort: 'stall', auslauf: start.slice(6) as 'L' | '0' } : { ort: 'weide', parcel_id: start }
    const id = herdeAnlegen(db(), { name, kategorie, anzahl: anzahl.trim() ? Number(anzahl) : null }, ziel, von)
    onFertig(name.trim(), id)
  }
  return (
    <Modal title="Neue Herde" onClose={onClose} onSubmit={speichern}>
      <div className="space-y-3 text-sm" data-testid="herde-dialog">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Name</span>
          <input className="inp w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Milchkühe, Jungvieh" aria-label="Name der Herde" />
        </label>
        <div>
          <span className="mb-1 block font-medium text-gray-700">Tiere</span>
          <div className="flex flex-wrap gap-1">
            {ANIMAL_CATEGORIES.map((c) => (
              <button key={c} type="button" className={`chip ${kategorie === c ? 'chip-on' : 'chip-off'}`} onClick={() => setKategorie(c)}>
                {ANIMAL_CATEGORY_LETTER[c]} {ANIMAL_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <input className="inp mt-2 w-28" inputMode="numeric" placeholder="Anzahl" value={anzahl} onChange={(e) => setAnzahl(e.target.value)} aria-label="Anzahl Tiere" />
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block font-medium text-gray-700">Ist jetzt</span>
            <select className="inp w-full" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Ist jetzt">
              <option value="stall:L">im Stall mit Laufhof</option>
              <option value="stall:0">im Stall ohne Auslauf</option>
              {auswahl.parcels.map((p) => (
                <option key={p.id} value={p.id}>
                  auf {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="w-36">
            <span className="mb-1 block font-medium text-gray-700">seit</span>
            <input type="date" className="inp w-full" value={von} onChange={(e) => setVon(e.target.value)} />
          </label>
        </div>
        {auswahl.hinweis}
        <div className="flex justify-end gap-2 border-t pt-3">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn-primary" disabled={!ok} onClick={speichern}>
            Herde anlegen
          </button>
        </div>
      </div>
    </Modal>
  )
}
