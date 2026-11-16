// Weide/Auslauf-Automatik (Wunsch des Betriebs 16.11.2026): ein Dialog mit dem Vorschlag für den Tag. Herden, Weiden von Hand und
// Laufhof sind vorausgefüllt; man bestätigt alles mit einem Tipp, ändert einzelne Zeilen (andere Parzelle, Anzahl, Stall)
// oder beantwortet die wenigen offenen Fragen (Laufhof ohne Herleitung). Gespeichert wird erst beim Bestätigen.
import { useMemo, useState } from 'react'
import Modal from './Modal'
import { ParzellenListe } from './Finder'
import { Schritte } from './Masken'
import { db } from '../db/db'
import { ANIMAL_CATEGORY_LABEL, fmtDate } from '../lib/format'
import { herdeText } from '../lib/herden'
import { automatikSpeichern, automatikVorschlag, vorgabeWahl, type AutomatikWahl, type HerdeEntscheid } from '../lib/automatik'
import type { AnimalCategory, LaufhofWert, Parcel } from '../types'

const QUELLE: Record<string, string> = {
  gesetzt: 'von Hand gesetzt',
  gestern: 'wie gestern (von Hand)',
  weide: 'auto: Tiere auf der Weide',
  stall: 'auto: Herde im Stall',
  frage: 'keine Angabe – bitte wählen',
}

export default function AutomatikDialog({
  datum,
  parcels,
  kategorien,
  onClose,
  onErfasst,
}: {
  datum: string
  parcels: Parcel[]
  kategorien: readonly AnimalCategory[]
  onClose: () => void
  onErfasst: (text: string, rueck: () => void) => void
}) {
  const a = useMemo(() => automatikVorschlag(db(), datum, parcels, kategorien), [datum, parcels, kategorien])
  const [w, setW] = useState<AutomatikWahl>(() => vorgabeWahl(a))
  const [wahlFuer, setWahlFuer] = useState<string | null>(null) // Herde oder Weide, für die eine andere Parzelle gewählt wird
  const name = (id: string | null | undefined) => parcels.find((p) => p.id === id)?.name ?? '?'
  const offeneFragen = a.laufhof.filter((l) => l.quelle === 'frage' && !(l.kategorie in w.laufhof))
  const leer = !a.herden.length && !a.weiden.length && !a.laufhof.length

  const herdeSetzen = (id: string, e: HerdeEntscheid) => setW((x) => ({ ...x, herden: { ...x.herden, [id]: e } }))
  const weideSetzen = (key: string, patch: Partial<AutomatikWahl['weiden'][string]>) => setW((x) => ({ ...x, weiden: { ...x.weiden, [key]: { ...x.weiden[key], ...patch } } }))
  const laufhofSetzen = (k: AnimalCategory, v: LaufhofWert) => setW((x) => ({ ...x, laufhof: { ...x.laufhof, [k]: v } }))

  return (
    <Modal title={`Weide und Auslauf · ${fmtDate(datum)}`} onClose={onClose} wide dirty={false}>
      <div className="space-y-4" data-testid="automatik">
        <p className="text-sm text-gray-700">
          Vorschlag aus Herden, gestern und der Laufhof-Automatik. Bitte prüfen und bestätigen; geändert werden muss meist nichts.
        </p>
        {leer && <p className="text-sm text-gray-600">Nichts herzuleiten: keine Herden, keine Weide gestern, kein Laufhof.</p>}

        {a.herden.length > 0 && (
          <section className="space-y-2" aria-labelledby="auto-herden">
            <h3 id="auto-herden" className="text-sm font-semibold text-gray-800">
              Herden
            </h3>
            {a.herden.map((z) => {
              const e = w.herden[z.herde.id] ?? { art: 'bleibt' }
              const ort = z.heute ?? z.gestern!
              const wo = ort.ort === 'weide' ? `auf ${name(ort.parcel_id)}` : `im Stall (${ort.auslauf === '0' ? 'ohne Auslauf' : 'Laufhof'})`
              return (
                <div key={z.herde.id} className="rounded-lg p-2 ring-1 ring-gray-300" data-automatik-herde={z.herde.name}>
                  <div className="text-sm">
                    <span className="font-medium text-gray-800">{herdeText(z.herde)}</span>{' '}
                    <span className="text-gray-600">
                      {wo}, {z.seit}. Tag{!z.heute && ' (gestern; heute noch nichts erfasst)'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`${z.herde.name}: heute`}>
                    <Chip an={e.art === 'bleibt'} onClick={() => herdeSetzen(z.herde.id, { art: 'bleibt' })}>
                      ✓ bleibt
                    </Chip>
                    <Chip an={e.art === 'weide'} onClick={() => setWahlFuer(`h:${z.herde.id}`)}>
                      {e.art === 'weide' ? `→ ${name(e.parcel_id)}` : 'andere Weide …'}
                    </Chip>
                    <Chip an={e.art === 'stall' && e.auslauf === 'L'} onClick={() => herdeSetzen(z.herde.id, { art: 'stall', auslauf: 'L' })}>
                      Stall, Laufhof
                    </Chip>
                    <Chip an={e.art === 'stall' && e.auslauf === '0'} onClick={() => herdeSetzen(z.herde.id, { art: 'stall', auslauf: '0' })}>
                      Stall, kein Auslauf
                    </Chip>
                  </div>
                  {wahlFuer === `h:${z.herde.id}` && (
                    <div className="mt-2">
                      <ParzellenListe
                        parcels={parcels}
                        jahr={Number(datum.slice(0, 4))}
                        hoehe="max-h-[35vh]"
                        onWahl={(p) => {
                          herdeSetzen(z.herde.id, { art: 'weide', parcel_id: p.id })
                          setWahlFuer(null)
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {a.weiden.length > 0 && (
          <section className="space-y-2" aria-labelledby="auto-weiden">
            <h3 id="auto-weiden" className="text-sm font-semibold text-gray-800">
              Weide wie gestern
            </h3>
            {a.weiden.map((v) => {
              const x = w.weiden[v.key]
              return (
                <div key={v.key} className={`rounded-lg p-2 ring-1 ${x.an ? 'ring-gray-300' : 'opacity-60 ring-gray-200'}`} data-automatik-weide={v.parcel.name}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-5 w-5" checked={x.an} onChange={(e) => weideSetzen(v.key, { an: e.target.checked })} />
                    <span>
                      <span className="font-medium text-gray-800">{x.parcel.name}</span>{' '}
                      <span className="text-gray-600">
                        · {ANIMAL_CATEGORY_LABEL[x.tiere.animal_category]}
                        {x.tiere.animal_group ? ` ${x.tiere.animal_group}` : ''} · {v.tage + 1}. Tag
                        {x.parcel.id !== v.parcel.id && ` (statt ${v.parcel.name})`}
                      </span>
                    </span>
                  </label>
                  {x.an && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Schritte wert={x.tiere.animal_count} onWert={(n) => weideSetzen(v.key, { tiere: { ...x.tiere, animal_count: n } })} label={`Anzahl Tiere ${v.parcel.name}`} leer />
                      <Chip an={wahlFuer === `w:${v.key}`} onClick={() => setWahlFuer(wahlFuer === `w:${v.key}` ? null : `w:${v.key}`)}>
                        andere Parzelle …
                      </Chip>
                    </div>
                  )}
                  {wahlFuer === `w:${v.key}` && (
                    <div className="mt-2">
                      <ParzellenListe
                        parcels={parcels}
                        jahr={Number(datum.slice(0, 4))}
                        hoehe="max-h-[35vh]"
                        onWahl={(p) => {
                          weideSetzen(v.key, { parcel: p })
                          setWahlFuer(null)
                        }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )}

        {a.laufhof.length > 0 && (
          <section className="space-y-2" aria-labelledby="auto-laufhof">
            <h3 id="auto-laufhof" className="text-sm font-semibold text-gray-800">
              Laufhof
            </h3>
            {a.laufhof.map((l) => {
              const gewaehlt = l.kategorie in w.laufhof ? w.laufhof[l.kategorie]! : l.quelle === 'frage' ? undefined : l.vorschlag
              const frage = l.quelle === 'frage' && !(l.kategorie in w.laufhof)
              return (
                <div key={l.kategorie} className={`flex flex-wrap items-center gap-2 rounded-lg p-2 ring-1 ${frage ? 'bg-amber-50 ring-amber-400' : 'ring-gray-300'}`} data-automatik-laufhof={l.kategorie}>
                  <span className="w-24 text-sm font-medium text-gray-800">{ANIMAL_CATEGORY_LABEL[l.kategorie]}</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Laufhof ${ANIMAL_CATEGORY_LABEL[l.kategorie]}`}>
                    {l.quelle !== 'frage' && (
                      <Chip an={gewaehlt === null} onClick={() => laufhofSetzen(l.kategorie, null)}>
                        auto{l.anzeige ? ` (${l.anzeige})` : ''}
                      </Chip>
                    )}
                    {(['X', 'L', '0'] as const).map((v) => (
                      <Chip key={v} an={gewaehlt === v} onClick={() => laufhofSetzen(l.kategorie, v)}>
                        {v === 'X' ? 'X Weide' : v === 'L' ? 'L Laufhof' : '0 kein Auslauf'}
                      </Chip>
                    ))}
                    {l.quelle === 'frage' && (
                      <Chip an={l.kategorie in w.laufhof && w.laufhof[l.kategorie] === null} onClick={() => laufhofSetzen(l.kategorie, null)}>
                        offen lassen
                      </Chip>
                    )}
                  </div>
                  <span className="w-full text-xs text-gray-600">{QUELLE[l.quelle]}</span>
                </div>
              )
            })}
          </section>
        )}
      </div>
      <div className="sticky -bottom-4 -mx-4 mt-3 flex items-center gap-2 border-t bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
        <p className="min-w-0 flex-1 text-sm text-gray-700" aria-live="polite">
          {offeneFragen.length ? `Noch ${offeneFragen.length} ${offeneFragen.length === 1 ? 'Frage' : 'Fragen'} zum Laufhof` : 'Bereit zum Bestätigen'}
        </p>
        <button type="button" className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={leer || offeneFragen.length > 0}
          data-testid="automatik-bestaetigen"
          onClick={() => {
            const r = automatikSpeichern(db(), a, w)
            onErfasst(r.text, r.rueck)
            onClose()
          }}
        >
          ✓ Bestätigen
        </button>
      </div>
    </Modal>
  )
}

function Chip({ an, onClick, children }: { an: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={an} onClick={onClick} className={`chip min-h-10 px-3 text-sm sm:min-h-8 ${an ? 'chip-on' : 'chip-off'}`}>
      {children}
    </button>
  )
}
