// Masken für Tätigkeiten (Etappe 3, Skizzen B2/B3): Düngen, Schnitt, Weide, Pflege. Ein Bildschirm, drei Fragen (was – wo –
// wann), mehrere Parzellen auf einmal, Summe unten. Gespeichert wird mit lib/masken.ts (dieselben Funktionen wie im Raster);
// danach «Rückgängig» wie bei der Kürzelleiste.
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from '../fmis/router'
import Modal from './Modal'
import { ParzellenListe } from './Finder'
import { db } from '../db/db'
import { loadFertilizerTypes } from '../lib/fertilization'
import { addDaysIso, ANIMAL_CATEGORIES, ANIMAL_CATEGORY_LABEL, ANIMAL_CATEGORY_LETTER, fmtDate, fmtNum, num, todayIso, UNIT_LABEL, USAGE_TYPE_LABEL, USAGE_TYPE_LETTER, YIELD_UNIT_LABEL } from '../lib/format'
import {
  duengenSpeichern,
  letzteEinheit,
  letzterGemeinsamerSchnitt,
  mengeGesamt,
  mengeProHa,
  PFLEGE,
  pflegeSpeichern,
  SCHNITTE,
  schnittNummer,
  schnittSpeichern,
  summeAren,
  weideSpeichern,
} from '../lib/masken'
import { letzteGabe, letzteTiere, rueckgaengig, tageVonBis, type Erfasst, type Tiere } from '../lib/schnell'
import type { AnimalCategory, FertilizerType, Parcel, UsageType, YieldUnit } from '../types'

export type MaskenArt = 'weide' | 'schnitt' | 'duengen' | 'pflege'
export const MASKEN_TITEL: Record<MaskenArt, string> = { weide: 'Weide', schnitt: 'Schnitt', duengen: 'Düngen', pflege: 'Pflege' }

type Props = { datum: string; parcels: Parcel[]; vorwahl?: Parcel[]; onClose: () => void; onErfasst: (text: string, rueck: () => void) => void }

export default function Maske({ art, ...p }: Props & { art: MaskenArt }) {
  if (art === 'duengen') return <Duengen {...p} />
  if (art === 'schnitt') return <Schnitt {...p} />
  if (art === 'weide') return <Weide {...p} />
  return <Pflege {...p} />
}

// ---------- Bausteine ----------

function Frage({ nr, titel, children, rechts }: { nr: number; titel: string; children: ReactNode; rechts?: ReactNode }) {
  return (
    <section className="space-y-2 border-b pb-3 last:border-b-0" aria-labelledby={`frage-${nr}`}>
      <div className="flex items-center gap-2">
        <h3 id={`frage-${nr}`} className="text-sm font-semibold text-gray-800">
          {nr} · {titel}
        </h3>
        {rechts && <div className="ml-auto">{rechts}</div>}
      </div>
      {children}
    </section>
  )
}

function Wahl<T extends string>({ werte, wert, onWahl, text, name }: { werte: T[]; wert: T | null; onWahl: (v: T) => void; text: (v: T) => ReactNode; name: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={name}>
      {werte.map((v) => (
        <button key={v} type="button" aria-pressed={v === wert} className={`chip ${v === wert ? 'chip-on' : 'chip-off'} min-h-11 px-3 text-sm sm:min-h-9`} onClick={() => onWahl(v)}>
          {text(v)}
        </button>
      ))}
    </div>
  )
}

/** Zahl mit grossen − / + (Skizze: «grosse Plus/Minus statt Tastatur») */
export function Schritte({ wert, onWert, label, schritt = 1, min = 0, leer = false }: { wert: number | null; onWert: (v: number | null) => void; label: string; schritt?: number; min?: number; leer?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn h-11 w-11 p-0 text-lg sm:h-9 sm:w-9" aria-label={`${label} weniger`} onClick={() => onWert(Math.max(min, (wert ?? 0) - schritt))}>
        −
      </button>
      <input
        className="inp h-11 w-20 text-center text-base sm:h-9"
        inputMode="decimal"
        aria-label={label}
        value={wert == null ? '' : String(wert)}
        placeholder={leer ? '–' : '0'}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.').trim()
          const v = Number(t)
          onWert(t === '' ? null : Number.isFinite(v) ? v : wert)
        }}
      />
      <button type="button" className="btn h-11 w-11 p-0 text-lg sm:h-9 sm:w-9" aria-label={`${label} mehr`} onClick={() => onWert((wert ?? 0) + schritt)}>
        +
      </button>
    </div>
  )
}

function Wann({ datum, onDatum }: { datum: string; onDatum: (d: string) => void }) {
  const heute = todayIso()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Wahl name="Datum" werte={[heute, addDaysIso(heute, -1)]} wert={datum} onWahl={onDatum} text={(d) => (d === heute ? 'Heute' : 'Gestern')} />
      <label className="flex items-center gap-1 text-sm text-gray-700">
        <span className="sr-only">Anderes Datum</span>
        <input type="date" className="inp h-11 sm:h-9" value={datum} onChange={(e) => e.target.value && onDatum(e.target.value)} />
      </label>
    </div>
  )
}

/** Parzellen wählen: gewählte als Chips, darunter die Liste mit Finder (Häkchen). */
function Wo({ parcels, gewaehlt, onGewaehlt, jahr, zusatz }: { parcels: Parcel[]; gewaehlt: Parcel[]; onGewaehlt: (ps: Parcel[]) => void; jahr: number; zusatz?: ReactNode }) {
  const [liste, setListe] = useState(gewaehlt.length === 0)
  const ids = gewaehlt.map((p) => p.id)
  return (
    <div className="space-y-2">
      {zusatz}
      {gewaehlt.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Gewählte Parzellen">
          {gewaehlt.map((p) => (
            <li key={p.id}>
              <button type="button" className="chip chip-on min-h-9 gap-1 text-sm" aria-label={`${p.name} abwählen`} onClick={() => onGewaehlt(gewaehlt.filter((x) => x.id !== p.id))}>
                {p.name} <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {liste ? (
        <>
          <ParzellenListe
            parcels={parcels}
            jahr={jahr}
            gewaehlt={ids}
            hoehe="max-h-[40vh]"
            onUmschalten={(p, an) => onGewaehlt(an ? [...gewaehlt, p] : gewaehlt.filter((x) => x.id !== p.id))}
          />
          {gewaehlt.length > 0 && (
            <button type="button" className="btn" onClick={() => setListe(false)} data-testid="wo-fertig">
              ✓ {gewaehlt.length} gewählt, Liste schliessen
            </button>
          )}
        </>
      ) : (
        <button type="button" className="btn" onClick={() => setListe(true)}>
          ＋ Parzellen wählen
        </button>
      )}
    </div>
  )
}

function Fuss({ text, ok, onSpeichern, onClose }: { text: string; ok: boolean; onSpeichern: () => void; onClose: () => void }) {
  return (
    <div className="sticky -bottom-4 -mx-4 mt-3 flex items-center gap-2 border-t bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:-bottom-4">
      <p className="min-w-0 flex-1 text-sm text-gray-700" aria-live="polite" data-testid="maske-summe">
        {text}
      </p>
      <button type="button" className="btn" onClick={onClose}>
        Abbrechen
      </button>
      <button type="button" className="btn-primary" disabled={!ok} onClick={onSpeichern} data-testid="maske-speichern">
        Speichern
      </button>
    </div>
  )
}

const ha = (ps: Parcel[]) => `${fmtNum(summeAren(ps) / 100, 2)} ha`
const n = (k: number, eins: string, viele: string) => `${k} ${k === 1 ? eins : viele}`
const fertig = (p: Props, text: string, erfasst: Erfasst[]) => {
  p.onErfasst(text, () => rueckgaengig(db(), erfasst))
  p.onClose()
}

// ---------- Düngen (B2) ----------

function Duengen(p: Props) {
  const s = db()
  const jahr = Number(p.datum.slice(0, 4))
  const typen = useMemo(() => loadFertilizerTypes(s), [s])
  const zuletzt = useMemo(() => letzteGabe(s, 'guelle') ?? letzteGabe(s, 'mist'), [s])
  // Schnellwahl: die zuletzt benutzten Sorten (bis 4), sonst die ersten Hofdünger
  const schnell = useMemo(() => {
    const ids: string[] = []
    for (const f of [...s.rows('fertilization_entries')].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1))) if (f.fertilizer_type_id && !ids.includes(f.fertilizer_type_id)) ids.push(f.fertilizer_type_id)
    const t = ids.map((id) => typen.find((x) => x.id === id)).filter(Boolean) as FertilizerType[]
    return (t.length ? t : typen.filter((x) => x.unit === 'm3' || x.unit === 't')).slice(0, 4)
  }, [s, typen])
  const [typ, setTyp] = useState<FertilizerType | null>(zuletzt?.type ?? schnell[0] ?? typen[0] ?? null)
  const fassArt = (t: FertilizerType | null) => !!t && (t.container_size != null || t.unit === 'm3')
  const [modus, setModus] = useState<'fass' | 'gesamt' | 'proha'>(fassArt(typ) ? 'fass' : 'gesamt')
  const [anzahl, setAnzahl] = useState<number | null>(null)
  const [inhalt, setInhalt] = useState<number | null>(zuletzt?.container_size ?? typ?.container_size ?? null)
  const [menge, setMenge] = useState<number | null>(null)
  const [proHa, setProHa] = useState<number | null>(zuletzt?.proHa != null ? Math.round(zuletzt.proHa) : null)
  const [verd, setVerd] = useState(zuletzt?.dilution ?? '')
  const [wo, setWo] = useState<Parcel[]>(p.vorwahl ?? [])
  const [datum, setDatum] = useState(p.datum)
  const einheit = typ ? (UNIT_LABEL[typ.unit] ?? typ.unit) : ''
  const flaecheHa = summeAren(wo) / 100
  const eingabe = {
    amount: modus === 'gesamt' ? menge : modus === 'proha' && proHa != null && flaecheHa > 0 ? Math.round(proHa * flaecheHa * 10) / 10 : null,
    container_count: modus === 'fass' ? anzahl : null,
    container_size: modus === 'fass' ? inhalt : null,
  }
  const gesamt = mengeGesamt(eingabe)
  const jeHa = mengeProHa({ ...eingabe, parcels: wo })
  const ok = !!typ && gesamt != null && gesamt > 0 && wo.length > 0
  const summe = [wo.length ? `${n(wo.length, 'Parzelle', 'Parzellen')} · ${ha(wo)}` : 'Noch keine Parzelle', gesamt ? `${fmtNum(gesamt, 1)} ${einheit}` : null, jeHa != null ? `${fmtNum(jeHa, 1)} ${einheit}/ha` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <Modal title={`Düngen · ${fmtDate(datum)}`} onClose={p.onClose} wide dirty={false}>
      <div className="space-y-3" data-testid="maske-duengen">
        <Frage nr={1} titel="Was">
          <Wahl name="Dünger" werte={schnell.map((t) => t.id)} wert={typ?.id ?? null} onWahl={(id) => {
            const t = typen.find((x) => x.id === id)!
            setTyp(t)
            setModus(fassArt(t) ? 'fass' : 'gesamt')
            if (t.container_size != null) setInhalt(t.container_size)
          }} text={(id) => {
            const t = typen.find((x) => x.id === id)!
            return <><b>{t.code}</b> <span className="ml-1 font-normal text-gray-600">{t.name}</span>{zuletzt?.type.id === id && <span className="ml-1 text-xs">· zuletzt</span>}</>
          }} />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            Andere
            <select className="inp min-h-10 sm:min-h-9" aria-label="Andere Düngerart" value={schnell.some((t) => t.id === typ?.id) ? '' : (typ?.id ?? '')} onChange={(e) => {
              const t = typen.find((x) => x.id === e.target.value)
              if (t) {
                setTyp(t)
                setModus(fassArt(t) ? 'fass' : 'gesamt')
              }
            }}>
              <option value="">…</option>
              {typen.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} {t.name}
                </option>
              ))}
            </select>
          </label>
          <Wahl name="Menge angeben" werte={['fass', 'gesamt', 'proha'] as const as unknown as ('fass' | 'gesamt' | 'proha')[]} wert={modus} onWahl={setModus} text={(m) => (m === 'fass' ? `Anzahl ${typ?.container_label ?? 'Fass'}` : m === 'gesamt' ? `${einheit} gesamt` : `${einheit}/ha`)} />
          {modus === 'fass' && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="mb-1 text-xs text-gray-600">Anzahl {typ?.container_label ?? 'Fass'}</div>
                <Schritte wert={anzahl} onWert={setAnzahl} label={`Anzahl ${typ?.container_label ?? 'Fass'}`} />
              </div>
              <label className="text-xs text-gray-600">
                Inhalt je {typ?.container_label ?? 'Fass'} ({einheit})
                <input className="inp mt-1 block h-11 w-24 sm:h-9" inputMode="decimal" value={inhalt ?? ''} onChange={(e) => setInhalt(num(e.target.value.replace(',', '.')))} />
              </label>
            </div>
          )}
          {modus === 'gesamt' && (
            <label className="block text-xs text-gray-600">
              Menge gesamt ({einheit})
              <input className="inp mt-1 block h-11 w-32 sm:h-9" inputMode="decimal" value={menge ?? ''} onChange={(e) => setMenge(num(e.target.value.replace(',', '.')))} />
            </label>
          )}
          {modus === 'proha' && (
            <div>
              <div className="mb-1 text-xs text-gray-600">Menge je Hektare ({einheit}/ha)</div>
              <Schritte wert={proHa} onWert={setProHa} label={`${einheit} je Hektare`} schritt={typ?.unit === 'm3' ? 5 : 1} />
            </div>
          )}
          {typ?.unit === 'm3' && (
            <label className="block text-xs text-gray-600">
              Verdünnung (z.B. 1:1)
              <input className="inp mt-1 block h-11 w-24 sm:h-9" value={verd} onChange={(e) => setVerd(e.target.value)} />
            </label>
          )}
        </Frage>
        <Frage nr={2} titel="Wo">
          <Wo parcels={p.parcels} gewaehlt={wo} onGewaehlt={setWo} jahr={jahr} />
          <p className="text-xs text-gray-600">Die Menge wird nach Fläche auf die Parzellen verteilt.</p>
        </Frage>
        <Frage nr={3} titel="Wann">
          <Wann datum={datum} onDatum={setDatum} />
          <p className="text-xs text-gray-600">
            Mit dem Fass unterwegs gewesen? <Link to="/fahrten" className="text-brand-700 underline">🚜 GPS-Fahrt</Link> verteilt die Fuhren selbst.
          </p>
        </Frage>
      </div>
      <Fuss
        text={summe}
        ok={ok}
        onClose={p.onClose}
        onSpeichern={() =>
          fertig(p, `${typ!.code} ${fmtNum(gesamt, 1)} ${einheit} auf ${n(wo.length, 'Parzelle', 'Parzellen')}`, duengenSpeichern(db(), { type: typ!, ...eingabe, dilution: verd.trim() || null, parcels: wo, datum }))
        }
      />
    </Modal>
  )
}

// ---------- Schnitt (B3) ----------

function Schnitt(p: Props) {
  const s = db()
  const jahr = Number(p.datum.slice(0, 4))
  const haeufig = useMemo(() => {
    const z = new Map<UsageType, number>()
    for (const u of s.rows('usage_entries')) if (SCHNITTE.includes(u.usage_type) && u.entry_date.startsWith(String(jahr))) z.set(u.usage_type, (z.get(u.usage_type) ?? 0) + 1)
    return [...z].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'silage'
  }, [s, jahr])
  const [art, setArt] = useState<UsageType>(haeufig)
  const [einheit, setEinheit] = useState<YieldUnit>(() => letzteEinheit(s))
  const [wo, setWo] = useState<Parcel[]>(p.vorwahl ?? [])
  const [ertrag, setErtrag] = useState<Record<string, number | null>>({})
  const [datum, setDatum] = useState(p.datum)
  const letzter = useMemo(() => letzterGemeinsamerSchnitt(s, datum), [s, datum])
  const vorschlag = letzter ? p.parcels.filter((x) => letzter.parcelIds.includes(x.id)) : []
  const mitErtrag = wo.filter((x) => ertrag[x.id] != null)
  const ohne = wo.filter((x) => ertrag[x.id] == null)
  const summeErtrag = mitErtrag.reduce((a, x) => a + (ertrag[x.id] ?? 0), 0)
  const summe = wo.length
    ? [
        `${USAGE_TYPE_LABEL[art]} · ${n(wo.length, 'Parzelle', 'Parzellen')} · ${ha(wo)}`,
        mitErtrag.length ? `${fmtNum(summeErtrag, 1)} ${YIELD_UNIT_LABEL[einheit]}` : null,
        ohne.length && mitErtrag.length ? `${ohne.map((x) => x.name).join(', ')} ohne Ertrag` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Noch keine Parzelle'
  return (
    <Modal title={`Schnitt · ${fmtDate(datum)}`} onClose={p.onClose} wide dirty={false}>
      <div className="space-y-3" data-testid="maske-schnitt">
        <Frage nr={1} titel="Was">
          <Wahl name="Art des Schnitts" werte={SCHNITTE} wert={art} onWahl={setArt} text={(u) => <><b>{USAGE_TYPE_LETTER[u]}</b> <span className="ml-1">{USAGE_TYPE_LABEL[u]}</span></>} />
        </Frage>
        <Frage nr={2} titel="Wo und wie viel">
          <Wo
            parcels={p.parcels}
            gewaehlt={wo}
            onGewaehlt={setWo}
            jahr={jahr}
            zusatz={
              vorschlag.length >= 2 && wo.length === 0 ? (
                <button type="button" className="btn w-full justify-start text-left" onClick={() => { setWo(vorschlag); setArt(letzter!.usage_type) }}>
                  ↻ Wie am {fmtDate(letzter!.datum)}: {vorschlag.map((x) => x.name).join(', ')}
                </button>
              ) : null
            }
          />
          {wo.length > 0 && (
            <>
              <ul className="divide-y rounded-lg ring-1 ring-gray-300" data-testid="schnitt-zeilen">
                {wo.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block font-medium text-gray-800">{x.name}</span>
                      <span className="text-xs text-gray-600">
                        {fmtNum((num(x.area_a) ?? 0) / 100, 2)} ha · {schnittNummer(s, x.id, datum)}. Schnitt
                      </span>
                    </span>
                    <Schritte wert={ertrag[x.id] ?? null} onWert={(v) => setErtrag((e) => ({ ...e, [x.id]: v }))} label={`Ertrag ${x.name}`} leer />
                  </li>
                ))}
              </ul>
              <Wahl name="Einheit" werte={Object.keys(YIELD_UNIT_LABEL) as YieldUnit[]} wert={einheit} onWahl={setEinheit} text={(u) => YIELD_UNIT_LABEL[u]} />
              <p className="text-xs text-gray-600">Ertrag leer lassen geht: «Heute» erinnert unter «Offen» daran.</p>
            </>
          )}
        </Frage>
        <Frage nr={3} titel="Wann">
          <Wann datum={datum} onDatum={setDatum} />
        </Frage>
      </div>
      <Fuss
        text={summe}
        ok={wo.length > 0}
        onClose={p.onClose}
        onSpeichern={() => fertig(p, `${USAGE_TYPE_LABEL[art]} auf ${n(wo.length, 'Parzelle', 'Parzellen')}`, schnittSpeichern(db(), { usage_type: art, einheit, datum, zeilen: wo.map((x) => ({ parcel: x, ertrag: ertrag[x.id] ?? null })) }))}
      />
    </Modal>
  )
}

// ---------- Weide ----------

function Weide(p: Props) {
  const s = db()
  const jahr = Number(p.datum.slice(0, 4))
  const zuletzt = useMemo(() => letzteTiere(s, 4), [s])
  const [tiere, setTiere] = useState<Tiere>(zuletzt[0] ?? { animal_category: 'kuehe', animal_group: null, animal_count: null })
  const [eigene, setEigene] = useState(zuletzt.length === 0)
  const [tagweide, setTagweide] = useState(false)
  const [wo, setWo] = useState<Parcel[]>(p.vorwahl ?? [])
  const [von, setVon] = useState(p.datum)
  const [bis, setBis] = useState(p.datum)
  const tage = von <= bis ? tageVonBis(von, bis).length : 0
  const tiereText = (t: Tiere) => [t.animal_count, ANIMAL_CATEGORY_LABEL[t.animal_category], t.animal_group].filter(Boolean).join(' ')
  const summe = wo.length ? `${tiereText(tiere)} · ${n(wo.length, 'Parzelle', 'Parzellen')} · ${n(tage, 'Tag', 'Tage')}${tagweide ? ' · Tagweide' : ''}` : 'Noch keine Parzelle'
  return (
    <Modal title={`Weide · ${fmtDate(von)}${bis !== von ? `–${fmtDate(bis)}` : ''}`} onClose={p.onClose} wide dirty={false}>
      <div className="space-y-3" data-testid="maske-weide">
        <Frage nr={1} titel="Welche Tiere" rechts={<Link to="/herden" className="text-xs text-brand-700 underline">Ganze Herde umziehen?</Link>}>
          {zuletzt.length > 0 && (
            <Wahl
              name="Zuletzt geweidet"
              werte={[...zuletzt.map((_, i) => String(i)), 'andere']}
              wert={eigene ? 'andere' : String(zuletzt.findIndex((t) => t === tiere))}
              onWahl={(v) => {
                if (v === 'andere') {
                  // andere Tiere: Art bleibt als Vorschlag, Anzahl und Gruppe neu
                  setEigene(true)
                  setTiere({ animal_category: tiere.animal_category, animal_group: null, animal_count: null })
                }
                else {
                  setEigene(false)
                  setTiere(zuletzt[Number(v)])
                }
              }}
              text={(v) => (v === 'andere' ? 'Andere …' : tiereText(zuletzt[Number(v)]))}
            />
          )}
          {eigene && (
            <div className="space-y-2">
              <Wahl name="Tierart" werte={[...ANIMAL_CATEGORIES] as AnimalCategory[]} wert={tiere.animal_category} onWahl={(c) => setTiere({ ...tiere, animal_category: c })} text={(c) => `${ANIMAL_CATEGORY_LETTER[c]} ${ANIMAL_CATEGORY_LABEL[c]}`} />
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <div className="mb-1 text-xs text-gray-600">Anzahl Tiere</div>
                  <Schritte wert={tiere.animal_count} onWert={(v) => setTiere({ ...tiere, animal_count: v })} label="Anzahl Tiere" leer />
                </div>
                <label className="min-w-0 flex-1 text-xs text-gray-600">
                  Tiergruppe
                  <input className="inp mt-1 block h-11 w-full sm:h-9" value={tiere.animal_group ?? ''} onChange={(e) => setTiere({ ...tiere, animal_group: e.target.value || null })} />
                </label>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="h-5 w-5" checked={tagweide} onChange={(e) => setTagweide(e.target.checked)} />
            nur Tagweide
          </label>
        </Frage>
        <Frage nr={2} titel="Wo">
          <Wo parcels={p.parcels} gewaehlt={wo} onGewaehlt={setWo} jahr={jahr} />
        </Frage>
        <Frage nr={3} titel="Wann">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-600">
              von
              <input type="date" className="inp mt-1 block h-11 sm:h-9" value={von} onChange={(e) => e.target.value && setVon(e.target.value)} />
            </label>
            <label className="text-xs text-gray-600">
              bis
              <input type="date" className="inp mt-1 block h-11 sm:h-9" value={bis} onChange={(e) => e.target.value && setBis(e.target.value)} />
            </label>
            <button type="button" className="btn" onClick={() => { setVon(addDaysIso(p.datum, -6)); setBis(p.datum) }}>
              letzte 7 Tage
            </button>
          </div>
          {von > bis && <p className="text-xs text-red-700">«bis» liegt vor «von».</p>}
        </Frage>
      </div>
      <Fuss
        text={summe}
        ok={wo.length > 0 && tage > 0}
        onClose={p.onClose}
        onSpeichern={() => fertig(p, `Weide ${tiereText(tiere)}: ${n(wo.length, 'Parzelle', 'Parzellen')}, ${n(tage, 'Tag', 'Tage')}`, weideSpeichern(db(), { parcels: wo, von, bis, tiere, tagweide }))}
      />
    </Modal>
  )
}

// ---------- Pflege ----------

const MIT_SAAT: UsageType[] = ['uebersaat', 'saat']

function Pflege(p: Props) {
  const s = db()
  const jahr = Number(p.datum.slice(0, 4))
  const haeufig = useMemo(() => {
    const z = new Map<UsageType, number>()
    for (const u of s.rows('usage_entries')) if (PFLEGE.includes(u.usage_type) && u.entry_date.startsWith(String(jahr))) z.set(u.usage_type, (z.get(u.usage_type) ?? 0) + 1)
    return [...z].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'weide_putzen'
  }, [s, jahr])
  const [art, setArt] = useState<UsageType>(haeufig)
  const [label, setLabel] = useState('')
  const [wert, setWert] = useState<number | null>(null)
  const [wo, setWo] = useState<Parcel[]>(p.vorwahl ?? [])
  const [datum, setDatum] = useState(p.datum)
  const saat = MIT_SAAT.includes(art)
  const hoehe = art === 'aufwuchshoehe'
  const summe = wo.length ? `${USAGE_TYPE_LABEL[art]} · ${n(wo.length, 'Parzelle', 'Parzellen')} · ${ha(wo)}` : 'Noch keine Parzelle'
  return (
    <Modal title={`Pflege · ${fmtDate(datum)}`} onClose={p.onClose} wide dirty={false}>
      <div className="space-y-3" data-testid="maske-pflege">
        <Frage nr={1} titel="Was">
          <Wahl name="Art der Pflege" werte={PFLEGE} wert={art} onWahl={setArt} text={(u) => USAGE_TYPE_LABEL[u]} />
          {!hoehe && (
            <label className="block text-xs text-gray-600">
              {saat ? 'Mischung / Kultur' : art === 'sonstig' ? 'Was?' : 'Mittel / Bemerkung'}
              <input className="inp mt-1 block h-11 w-full sm:h-9" value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          )}
          {(saat || hoehe) && (
            <div>
              <div className="mb-1 text-xs text-gray-600">{saat ? 'Saatmenge kg/ha' : 'Aufwuchshöhe cm (Deckelmethode)'}</div>
              <Schritte wert={wert} onWert={setWert} label={saat ? 'Saatmenge kg/ha' : 'Aufwuchshöhe cm'} leer />
            </div>
          )}
        </Frage>
        <Frage nr={2} titel="Wo">
          <Wo parcels={p.parcels} gewaehlt={wo} onGewaehlt={setWo} jahr={jahr} />
        </Frage>
        <Frage nr={3} titel="Wann">
          <Wann datum={datum} onDatum={setDatum} />
        </Frage>
      </div>
      <Fuss
        text={summe}
        ok={wo.length > 0 && (art !== 'sonstig' || !!label.trim())}
        onClose={p.onClose}
        onSpeichern={() => fertig(p, `${USAGE_TYPE_LABEL[art]} auf ${n(wo.length, 'Parzelle', 'Parzellen')}`, pflegeSpeichern(db(), { usage_type: art, parcels: wo, datum, label: label.trim() || null, wert }))}
      />
    </Modal>
  )
}
