// Ansicht «Heute» (B, Etappe 2; früher Tageskarte): eine Seite je Tag, Wischen wechselt den Tag. Oben die Tätigkeiten
// Weide, Schnitt, Düngen, Pflege, je mit eigener Maske (Etappe 3, components/Masken.tsx); darunter Laufhof, Herden,
// Vorschläge zum Abhaken, was an diesem Tag schon erfasst ist, und «Offen» (fehlender Ertrag, unvollständige Gaben).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from '../fmis/router'
import type { Store } from '../db/store'
import { db } from '../db/db'
import { useQuery } from '../hooks/useQuery'
import { addDaysIso, ANIMAL_CATEGORY_LABEL, fmtDate, todayIso, UNIT_LABEL, usageDescription } from '../lib/format'
import { ausnahmenAm, ausnahmeText, laufhofKategorien, laufhofSetzen, weideKategorien } from '../lib/laufhof'
import { KUERZEL, rueckgaengig, schnellErfassen } from '../lib/schnell'
import { aufenthaltAm, herdenListe, nutzungen, stallAuslauf } from '../lib/herden'
import HerdenKarte from '../components/HerdenKarte'
import { allesWieGestern, inDerNaehe, koennteFaellig, laufhofGestern, wieGestern } from '../lib/tageskarte'
import { aktuellePosition } from '../lib/standort'
import KuerzelLeiste, { RueckgaengigToast } from '../components/KuerzelLeiste'
import DayEntryEditor from '../components/DayEntryEditor'
import { AusnahmeDialog } from '../components/LaufhofAuswahl'
import type { AnimalCategory, LaufhofWert, Parcel } from '../types'
import { kleineAusblenden, kleinStand } from '../lib/klein'
import KleinHinweis from '../components/KleinHinweis'
import Modal from '../components/Modal'
import { ParzellenListe } from '../components/Finder'
import { AnsichtUmschalter, StartFrage } from '../components/Ansicht'
import Maske, { type MaskenArt } from '../components/Masken'
import AutomatikDialog from '../components/Automatik'
import { offen } from '../lib/masken'
import { gemeinsamerTagSetzen } from '../lib/ansicht'
import DailyLogEditor from '../components/DailyLogEditor'
import { useRegen } from '../hooks/useRegen'
import { fmtRegen, regenSumme, regenTag, REGEN_QUELLE } from '../lib/regen'

const TAETIGKEITEN: { key: MaskenArt; label: string; icon: string }[] = [
  { key: 'weide', label: 'Weide', icon: '🐄' },
  { key: 'schnitt', label: 'Schnitt', icon: '🌾' },
  { key: 'duengen', label: 'Düngen', icon: '💧' },
  { key: 'pflege', label: 'Pflege', icon: '🧹' },
]

function laden(s: Store, datum: string, kleineZeigen: boolean) {
  const jahr = Number(datum.slice(0, 4))
  const parcels = s
    .rows('parcels')
    .filter((p) => p.season_year === jahr)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de'))
  const von = addDaysIso(datum, -30)
  const usage = nutzungen(s, von, datum)
  const logs = s.rows('daily_farm_log').filter((l) => l.entry_date >= von && l.entry_date <= datum)
  const ausnahmen = s.rows('auslauf_ausnahmen')
  const kategorien = laufhofKategorien(weideKategorien(usage), logs, ausnahmen.filter((a) => a.bis >= von && a.von <= datum))
  const heuteWeide = weideKategorien(usage.filter((u) => u.entry_date === datum)).get(datum) ?? new Set<AnimalCategory>()
  const log = logs.find((l) => l.entry_date === datum) ?? null
  const stall = stallAuslauf(s, datum, datum).get(datum) ?? new Map<AnimalCategory, 'L' | '0'>()
  const herden = herdenListe(s).map((h) => ({ herde: h, aufenthalt: aufenthaltAm(s, h.id, datum) }))
  for (const h of herden) if (h.herde.aktiv) kategorien.includes(h.herde.kategorie) || kategorien.push(h.herde.kategorie)
  const byId = new Map(parcels.map((p) => [p.id, p]))
  // eine Gabe auf mehreren Parzellen (Maske Düngen): die übrigen Parzellen nennen
  const mitParzellen = (entryId: string, anker: string | null) =>
    s.rows('fertilization_shares').filter((x) => x.entry_id === entryId && x.parcel_id !== anker).map((x) => byId.get(x.parcel_id)?.name ?? '?').join(', ')
  const erfasst = [
    ...usage
      .filter((u) => u.entry_date === datum)
      .map((u) => ({ id: u.id, parcel: byId.get(u.parcel_id), text: u.herde_aufenthalt_id ? `${usageDescription(u)} · Herde ${u.animal_group}` : usageDescription(u) })),
    ...s
      .rows('fertilization_entries')
      .filter((e) => e.entry_date === datum)
      .map((e) => ({
        id: e.id,
        parcel: byId.get(e.parcel_id ?? ''),
        text: `${e.code ?? 'Düngung'}${e.amount != null ? ` ${Number(e.amount)} ${UNIT_LABEL[e.unit ?? ''] ?? e.unit ?? ''}` : ''}${e.container_count != null ? ` (${Number(e.container_count)} Fass)` : ''}${
          e.extent_type === 'parcels' ? ` · mit ${mitParzellen(e.id, e.parcel_id)}` : ''
        }`,
      })),
  ].filter((x): x is { id: string; parcel: Parcel; text: string } => !!x.parcel)
  // Auswahl (＋ Parzelle, In der Nähe) ohne kleine Parzellen; Erfasstes und Vorschläge hängen an Daten und bleiben
  const klein = kleineAusblenden(parcels, kleinStand(s, jahr), kleineZeigen)
  return {
    parcels,
    klein,
    kategorien,
    heuteWeide,
    stall,
    herden,
    log,
    // Niederschlag von Hand je Tag (für Tageswert und 7-Tage-Summe; sonst automatisch von graswachstum.ch)
    regenHand: new Map(logs.filter((l) => l.niederschlag_mm != null).map((l) => [l.entry_date, Number(l.niederschlag_mm)])),
    ausnahmen,
    erfasst,
    gestern: wieGestern(s, datum, parcels),
    laufhofGestern: laufhofGestern(s, datum, kategorien),
    faellig: koennteFaellig(s, datum, klein.sichtbar),
  }
}

const kurzDatum = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`

const langesDatum = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

type Naehe = { status: 'aus' | 'suchen' | 'ok' | 'fehler'; liste: { parcel: Parcel; m: number }[]; fehler?: string }

export default function TagPage() {
  const params = useParams()
  const navigate = useNavigate()
  const heute = todayIso()
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(params.datum ?? '') ? params.datum! : heute
  const geheZu = useCallback((d: string) => navigate(`/tag/${d}`, { replace: true }), [navigate])
  const [kleineZeigen, setKleineZeigen] = useState(false)
  const { data } = useQuery((s) => laden(s, datum, kleineZeigen), [datum, kleineZeigen])
  const sichtbar = useMemo(() => new Set(data.klein.sichtbar.map((p) => p.id)), [data])

  const [leiste, setLeiste] = useState<{ parcel: Parcel; ort: { x: number; y: number } } | null>(null)
  const [editor, setEditor] = useState<Parcel | null>(null)
  const [editorGabe, setEditorGabe] = useState<'guelle' | 'mist' | undefined>(undefined)
  const [taetigkeit, setTaetigkeit] = useState<MaskenArt | null>(null)
  const [automatik, setAutomatik] = useState(false)
  // Nachtragen aus «Offen»: Tagesdialog einer Parzelle an einem anderen Tag
  const [nachtragen, setNachtragen] = useState<{ parcel: Parcel; datum: string } | null>(null)
  const { data: luecken } = useQuery((s) => offen(s), [])
  // der Tag gilt in allen Ansichten (Raster, Jahr)
  useEffect(() => gemeinsamerTagSetzen(datum), [datum])

  // «＋ Parzelle …»: Auswahl mit Finder (Etappe 1) statt Systemliste mit 52 Namen
  const [wahlOrt, setWahlOrt] = useState<{ x: number; y: number } | null>(null)
  const [ausnahme, setAusnahme] = useState<AnimalCategory | null>(null)
  const [toast, setToast] = useState<{ text: string; rueck: () => void; n: number } | null>(null)
  const zeigeToast = useCallback((text: string, rueck: () => void) => setToast((t) => ({ text, rueck, n: (t?.n ?? 0) + 1 })), [])
  const toastWeg = useCallback(() => setToast(null), [])
  const leisteZu = useCallback(() => setLeiste(null), [])
  const ortVon = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.bottom }
  }

  // In der Nähe: nur mit Standortfreigabe; ohne Freigabe erst auf Knopfdruck fragen
  const [naehe, setNaehe] = useState<Naehe>({ status: 'aus', liste: [] })
  const naeheSuchen = useCallback(async () => {
    setNaehe((n) => ({ ...n, status: 'suchen' }))
    try {
      const fix = await aktuellePosition(60000)
      setNaehe({ status: 'ok', liste: inDerNaehe(db().rows('parcels').filter((p) => p.season_year === Number(datum.slice(0, 4))), fix.lat, fix.lng) })
    } catch (e) {
      setNaehe({ status: 'fehler', liste: [], fehler: e instanceof Error ? e.message : String(e) })
    }
  }, [datum])
  useEffect(() => {
    let weg = false
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (!weg && p.state === 'granted') void naeheSuchen()
      })
      .catch(() => {})
    return () => {
      weg = true
    }
  }, [naeheSuchen])

  // Wischen links/rechts wechselt den Tag; Pfeiltasten am Computer
  const wisch = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]')) return
      if (e.key === 'ArrowLeft') geheZu(addDaysIso(datum, -1))
      if (e.key === 'ArrowRight') geheZu(addDaysIso(datum, 1))
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [datum, geheZu])

  const nutzung = (key: string) => KUERZEL.find((k) => k.key === key)!

  function gesternUebernehmen(i: number) {
    const v = data.gestern[i]
    const e = schnellErfassen(db(), v.parcel, [datum], v.kuerzel, { tiere: v.tiere })
    zeigeToast(`${v.parcel.name}: ${v.text}`, () => rueckgaengig(db(), e))
  }
  function allesUebernehmen() {
    const r = allesWieGestern(db(), datum, data.parcels, data.kategorien)
    const n = r.erfasst.length + r.laufhof.length
    zeigeToast(`Wie gestern: ${n} ${n === 1 ? 'Eintrag' : 'Einträge'}`, () => {
      rueckgaengig(db(), r.erfasst)
      for (const l of r.laufhof) laufhofSetzen(db(), datum, l.kategorie, null)
    })
  }

  // Regen: Tageswert und Summe der letzten 7 Tage; Tipp öffnet die Tagesmeldung (dort von Hand überschreiben)
  const [tagesmeldung, setTagesmeldung] = useState(false)
  const regenSpeicher = useRegen(Number(datum.slice(0, 4)))
  const regenHeute = regenTag(regenSpeicher, datum, data.regenHand.get(datum))
  const regen7 = regenSumme(regenSpeicher, datum, 7, (d) => data.regenHand.get(d))
  const regenAuto = regen7.auto > 0

  const lfWert = (k: AnimalCategory) => ((data.log as unknown as Record<string, LaufhofWert> | null)?.[`laufhof_${k}`] ?? null) as LaufhofWert
  const allesN = data.gestern.length + data.laufhofGestern.length
  const istHeute = datum === heute

  return (
    <div
      className="mx-auto max-w-xl space-y-3 p-3"
      data-testid="tageskarte"
      data-datum={datum}
      onTouchStart={(e) => (wisch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const w = wisch.current
        wisch.current = null
        if (!w || leiste || editor || ausnahme || taetigkeit || tagesmeldung) return
        const dx = e.changedTouches[0].clientX - w.x
        const dy = e.changedTouches[0].clientY - w.y
        if (Math.abs(dx) > 70 && Math.abs(dy) < 50) geheZu(addDaysIso(datum, dx < 0 ? 1 : -1))
      }}
    >
      <div className="hidden justify-center sm:flex">
        <AnsichtUmschalter aktiv="heute" />
      </div>
      <StartFrage />
      <div className="flex items-center gap-2">
        <button type="button" className="btn h-10 w-10 p-0 text-lg" aria-label="Vortag" onClick={() => geheZu(addDaysIso(datum, -1))}>
          ‹
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-lg font-bold text-gray-800">{langesDatum(datum)}</h1>
          {!istHeute && (
            <button type="button" className="text-xs text-brand-700 underline" onClick={() => geheZu(heute)}>
              zu heute
            </button>
          )}
        </div>
        <button type="button" className="btn h-10 w-10 p-0 text-lg" aria-label="Folgetag" onClick={() => geheZu(addDaysIso(datum, 1))}>
          ›
        </button>
      </div>
      {data.parcels.length > 0 && (regenHeute || regen7.letzter) && (
        <button
          type="button"
          className="mx-auto -mt-1 block text-center text-sm text-gray-700 hover:underline"
          onClick={() => setTagesmeldung(true)}
          data-testid="regen-tag"
          aria-label={`Niederschlag ${regenHeute ? `${fmtRegen(regenHeute.mm)} mm${regenHeute.vonHand ? ', von Hand' : ''}` : 'noch kein Wert'}, letzte 7 Tage ${fmtRegen(regen7.mm)} mm${
            regen7.fehlen && regen7.letzter ? ` bis ${kurzDatum(regen7.letzter)}` : ''
          }${regenAuto ? `, Quelle ${REGEN_QUELLE}` : ''}. Tagesmeldung öffnen`}
        >
          <span aria-hidden>🌧 </span>
          <b className="font-semibold">{regenHeute ? `${fmtRegen(regenHeute.mm)} mm` : 'noch kein Wert'}</b>
          {regenHeute?.vonHand && <span className="text-gray-600"> (von Hand)</span>}
          <span className="text-gray-600">
            {' · 7 Tage '}
            {fmtRegen(regen7.mm)} mm{regen7.fehlen && regen7.letzter ? ` (bis ${kurzDatum(regen7.letzter)})` : ''}
          </span>
          {regenAuto && <span className="block text-xs italic text-gray-500">{REGEN_QUELLE}</span>}
        </button>
      )}

      {data.parcels.length === 0 ? (
        <p className="card p-4 text-sm text-gray-600">Für {datum.slice(0, 4)} sind noch keine Parzellen angelegt.</p>
      ) : (
        <>
          <section aria-label="Tätigkeiten" data-testid="taetigkeiten">
            {/* Etappe 3: jede Tätigkeit öffnet ihre Maske (was – wo – wann, mehrere Parzellen) */}
            <div className="grid grid-cols-4 gap-2">
              {TAETIGKEITEN.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="card flex min-h-16 flex-col items-center justify-center gap-0.5 p-2 text-sm font-medium text-gray-800 hover:bg-brand-50 active:bg-brand-100"
                  onClick={() => setTaetigkeit(t.key)}
                  data-taetigkeit={t.key}
                >
                  <span className="text-2xl leading-none" aria-hidden>
                    {t.icon}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
            {/* Weide/Auslauf-Automatik (Wunsch des Betriebs 16.11.2026): Vorschlag aus Herden, gestern und Laufhof, bestätigen */}
            <button
              type="button"
              className="btn mt-2 w-full justify-center border-brand-600 text-brand-800"
              onClick={() => setAutomatik(true)}
              data-testid="automatik-knopf"
            >
              🐄 Weide/Auslauf vorschlagen
            </button>
          </section>
          <section className="card p-3" aria-label="Laufhof">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Laufhof</h2>
            <div className="space-y-1.5">
              {data.kategorien.map((k) => {
                const w = lfWert(k)
                const aufWeide = data.heuteWeide.has(k)
                const stall = data.stall.get(k) ?? null
                const autoZeichen = aufWeide ? 'X' : (stall ?? 'auto')
                const aus = ausnahmenAm(data.ausnahmen, datum, k)
                const opt = (v: LaufhofWert, zeichen: string, titel: string) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={w === v}
                    title={titel}
                    onClick={() => laufhofSetzen(db(), datum, k, v)}
                    className={`h-9 min-w-[2.75rem] px-2 text-sm font-bold first:rounded-l-lg last:rounded-r-lg ${
                      w === v ? 'bg-brand-600 text-white' : 'bg-white text-gray-700 hover:bg-brand-50'
                    }`}
                  >
                    {zeichen}
                  </button>
                )
                return (
                  <div key={k}>
                    <div className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-sm text-gray-700">{ANIMAL_CATEGORY_LABEL[k]}</span>
                      <div role="radiogroup" aria-label={`Laufhof ${ANIMAL_CATEGORY_LABEL[k]}`} className="flex divide-x rounded-lg ring-1 ring-gray-300">
                        {opt(null, autoZeichen, aufWeide ? 'auto: auf Weide' : stall ? 'auto: Herde im Stall' : 'auto: X, wenn auf Weide')}
                        {opt('L', 'L', 'Laufhof')}
                        {opt('0', '0', 'kein Auslauf')}
                      </div>
                      <button type="button" className="ml-auto inline-flex min-h-10 items-center px-2 text-xs text-amber-800 underline sm:min-h-6" onClick={() => setAusnahme(k)}>
                        Ausnahme
                      </button>
                    </div>
                    {aus.map((a) => (
                      <p key={a.id} className="ml-24 pl-2 text-xs text-amber-800">
                        ! {ausnahmeText(a)}
                      </p>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>

          <HerdenKarte datum={datum} herden={data.herden} parcels={data.parcels} onToast={zeigeToast} />

          <section className="card p-3" aria-label="Wie gestern" data-testid="wie-gestern">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Wie gestern</h2>
              {allesN > 0 && (
                <button type="button" className="btn-primary ml-auto px-3 py-1.5 text-sm" onClick={allesUebernehmen}>
                  Alles wie gestern
                </button>
              )}
            </div>
            {allesN === 0 ? (
              <p className="text-sm text-gray-500">Nichts offen von gestern.</p>
            ) : (
              <ul className="divide-y">
                {data.gestern.map((v, i) => (
                  <Abhaken key={v.key} titel={v.parcel.name} text={v.text} onHaken={() => gesternUebernehmen(i)} />
                ))}
                {data.laufhofGestern.map((l) => (
                  <Abhaken
                    key={`lf|${l.kategorie}`}
                    titel={`Laufhof ${ANIMAL_CATEGORY_LABEL[l.kategorie]}`}
                    text={l.wert === 'L' ? 'L Laufhof' : l.wert === '0' ? '0 kein Auslauf' : 'X Weide'}
                    onHaken={() => {
                      laufhofSetzen(db(), datum, l.kategorie, l.wert)
                      zeigeToast(`Laufhof ${ANIMAL_CATEGORY_LABEL[l.kategorie]}: ${l.wert}`, () => laufhofSetzen(db(), datum, l.kategorie, null))
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          {data.faellig.length > 0 && (
            <section className="card p-3" aria-label="Könnte fällig sein" data-testid="faellig">
              <h2 className="mb-1 text-sm font-semibold text-gray-700">Könnte fällig sein</h2>
              <p className="mb-1 text-xs text-gray-500">Faustwerte: Weide nach 21 Tagen Ruhe, Schnitt nach 35 Tagen Aufwuchs.</p>
              <ul className="divide-y">
                {data.faellig.map((v) => (
                  <Abhaken
                    key={v.key}
                    titel={v.parcel.name}
                    text={v.text}
                    onHaken={(el) => {
                      if (v.art === 'weide' && v.tiere) {
                        const e = schnellErfassen(db(), v.parcel, [datum], nutzung('X'), { tiere: v.tiere })
                        zeigeToast(`${v.parcel.name}: Weide`, () => rueckgaengig(db(), e))
                      } else setLeiste({ parcel: v.parcel, ort: ortVon(el) })
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="card p-3" aria-label="In der Nähe" data-testid="naehe">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">In der Nähe</h2>
              {naehe.status !== 'suchen' && (
                <button type="button" className="btn ml-auto px-2 py-1 text-xs" onClick={naeheSuchen}>
                  {naehe.status === 'aus' ? '◎ Standort verwenden' : '↻ neu suchen'}
                </button>
              )}
            </div>
            {naehe.status === 'aus' && <p className="text-xs text-gray-500">Zeigt Parzellen bis 300 m um dich – nur mit Standortfreigabe.</p>}
            {naehe.status === 'suchen' && <p className="text-xs text-gray-500">Standort wird gesucht …</p>}
            {naehe.status === 'fehler' && <p className="text-xs text-red-700">{naehe.fehler}</p>}
            {naehe.status === 'ok' && naehe.liste.length === 0 && <p className="text-xs text-gray-500">Keine Parzelle im Umkreis von 300 m.</p>}
            {naehe.liste.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {naehe.liste.filter(({ parcel }) => sichtbar.has(parcel.id)).map(({ parcel, m }) => (
                  <button key={parcel.id} type="button" className="chip chip-off" onClick={(e) => setLeiste({ parcel, ort: ortVon(e.currentTarget) })}>
                    {parcel.name} <span className="text-gray-500">{m === 0 ? 'hier' : `${m} m`}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card p-3" aria-label="Erfasst" data-testid="erfasst">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Erfasst {istHeute ? 'heute' : 'an diesem Tag'}</h2>
              <button type="button" className="btn ml-auto text-xs" onClick={(e) => setWahlOrt(ortVon(e.currentTarget))}>
                ＋ Parzelle …
              </button>
            </div>
            {data.erfasst.length === 0 ? (
              <p className="text-sm text-gray-500">Noch nichts.</p>
            ) : (
              <ul className="divide-y">
                {data.erfasst.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="flex w-full items-center gap-2 py-2 text-left text-sm" onClick={() => setEditor(x.parcel)}>
                      <span className="text-brand-700">✓</span>
                      <span className="font-medium">{x.parcel.name}</span>
                      <span className="truncate text-gray-600">{x.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {luecken.length > 0 && (
            <section className="card p-3" aria-label="Offen" data-testid="offen">
              <h2 className="mb-1 text-sm font-semibold text-gray-700">Offen · {luecken.length}</h2>
              <ul className="divide-y">
                {luecken.map((o) => (
                  <li key={`${o.art}|${o.datum}|${o.text}`} className="py-2 text-sm">
                    <span className="font-medium text-gray-800">{o.titel}</span> <span className="text-gray-600">{o.text}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {o.parcelIds.map((id) => {
                        const parcel = db().get('parcels', id)
                        return parcel ? (
                          <button key={id} type="button" className="btn min-h-9 px-2 text-xs sm:min-h-7" onClick={() => setNachtragen({ parcel, datum: o.datum })}>
                            {parcel.name} nachtragen
                          </button>
                        ) : null
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <KleinHinweis className="px-1" anzahl={data.klein.ausgeblendet.length} grenze={data.klein.grenze_a} zeigen={kleineZeigen} onUmschalten={() => setKleineZeigen((v) => !v)} />
        </>
      )}

      {automatik && (
        <AutomatikDialog datum={datum} parcels={data.parcels} kategorien={data.kategorien} onClose={() => setAutomatik(false)} onErfasst={zeigeToast} />
      )}
      {taetigkeit && (
        <Maske art={taetigkeit} datum={datum} parcels={data.parcels} onClose={() => setTaetigkeit(null)} onErfasst={zeigeToast} />
      )}
      {nachtragen && (
        <DayEntryEditor parcel={nachtragen.parcel} parcels={data.parcels} seasonYear={Number(nachtragen.datum.slice(0, 4))} date={nachtragen.datum} onClose={() => setNachtragen(null)} />
      )}
      {wahlOrt && (
        <Modal title={`Parzelle für ${fmtDate(datum)}`} onClose={() => setWahlOrt(null)}>
          <ParzellenListe
            parcels={data.parcels}
            jahr={Number(datum.slice(0, 4))}
            onWahl={(p) => {
              setLeiste({ parcel: p, ort: wahlOrt })
              setWahlOrt(null)
            }}
          />
        </Modal>
      )}
      {leiste && (
        <KuerzelLeiste
          key={leiste.parcel.id}
          parcel={leiste.parcel}
          tage={[datum]}
          ort={leiste.ort}
          onClose={leisteZu}
          onDetails={(neueGabe) => {
            setEditorGabe(neueGabe)
            setEditor(leiste.parcel)
            setLeiste(null)
          }}
          onErfasst={zeigeToast}
        />
      )}
      {editor && <DayEntryEditor parcel={editor} parcels={data.parcels} seasonYear={Number(datum.slice(0, 4))} date={datum} neueGabe={editorGabe} onClose={() => {
        setEditor(null)
        setEditorGabe(undefined)
      }} />}
      {tagesmeldung && <DailyLogEditor date={datum} onClose={() => setTagesmeldung(false)} />}
      {ausnahme && <AusnahmeDialog kategorie={ausnahme} datum={datum} onClose={() => setAusnahme(null)} />}
      {toast && (
        <RueckgaengigToast
          key={toast.n}
          text={toast.text}
          onWeg={toastWeg}
          onRueckgaengig={() => {
            toast.rueck()
            setToast(null)
          }}
        />
      )}
    </div>
  )
}

/** Vorschlag mit rundem Haken: ein Tipp übernimmt ihn. */
function Abhaken({ titel, text, onHaken }: { titel: string; text: string; onHaken: (el: HTMLElement) => void }) {
  return (
    <li>
      <button type="button" className="flex min-h-11 w-full items-center gap-3 py-2 text-left" onClick={(e) => onHaken(e.currentTarget)} aria-label={`${titel}: ${text} übernehmen`}>
        {/* leerer Kreis: noch nicht erledigt (Befund R10); beim Darüberfahren der Haken als Vorschau */}
        <span className="group/k flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-700 text-transparent hover:text-brand-700" aria-hidden>
          ✓
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-800">{titel}</span>
          <span className="block truncate text-xs text-gray-600">{text}</span>
        </span>
      </button>
    </li>
  )
}

