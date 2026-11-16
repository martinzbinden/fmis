import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, Link } from '../fmis/router'
import type { Store } from '../db/store'
import { useQuery } from '../hooks/useQuery'
import { useYear } from '../hooks/useYear'
import { loadEntriesInRange } from '../lib/journal'
import { loadSharesInRange } from '../lib/fertilization'
import { addDaysIso, ANIMAL_CATEGORY_LABEL, fmtDate, isoDate, todayIso, USAGE_COLOR, USAGE_COLOR_LABEL, USAGE_TYPE_LABEL, USAGE_TYPE_LETTER } from '../lib/format'
import JournalGrid, { type DayIndex, type TastenAktion } from '../components/JournalGrid'
import DayEntryEditor from '../components/DayEntryEditor'
import DailyLogEditor from '../components/DailyLogEditor'
import ParzellenAnlegen from '../components/ParzellenAnlegen'
import { LaufhofMenue } from '../components/LaufhofAuswahl'
import KuerzelLeiste, { RueckgaengigToast } from '../components/KuerzelLeiste'
import { tageVonBis } from '../lib/schnell'
import { stallAuslauf } from '../lib/herden'
import { laufhofKategorien as laufhofKategorienFuer, weideKategorien } from '../lib/laufhof'
import type { AnimalCategory, LaufhofWert } from '../types'
import { FinderLeiste, useGefunden, useGemeinsamerFinder } from '../components/Finder'
import type { FertilizationEntry, Parcel, UsageEntry } from '../types'
import { useRegen } from '../hooks/useRegen'
import { regenAm, regenStand, REGEN_QUELLE } from '../lib/regen'
import { AnsichtUmschalter, StartFrage } from '../components/Ansicht'
import { KurznamenHinweis } from '../components/Kurznamen'
import { gemeinsamerTag, gemeinsamerTagSetzen, montag } from '../lib/ansicht'
import { useGemeinsamerTag } from '../components/Ansicht'
import { einfuegen, fuellen, kopieren, leeren, monatSprung, SPANNE_TEXT, spanneLesen, spanneMerken, zellbreite, type Spanne, type Vorlage } from '../lib/raster'
import { jahresband, vorTagen } from '../lib/jahresband'
import { db } from '../db/db'
import { gabeText, KUERZEL, letzteGabe, letzteTiere, rueckgaengig, schnellErfassen } from '../lib/schnell'

function seasonDays(year: number): string[] {
  const out: string[] = []
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}

function loadGrid(st: Store, year: number, from: string, to: string) {
  const parcels = st
    .rows('parcels')
    .filter((p) => p.season_year === year)
    .sort(
      (a, b) =>
        (a.farm_name ?? '\uffff').localeCompare(b.farm_name ?? '\uffff') ||
        b.category.localeCompare(a.category) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, 'de'),
    )
  const { usage, fertilizations } = loadEntriesInRange(st, from, to)
  const logs = st.rows('daily_farm_log').filter((l) => l.entry_date >= from && l.entry_date <= to)
  const ausnahmen = st.rows('auslauf_ausnahmen').filter((a) => a.bis >= from && a.von <= to)
  return { parcels, usage, fertilizations, logs, ausnahmen, stall: stallAuslauf(st, from, to), stays: new Map(st.rows('herden_aufenthalte').map((a) => [a.id, a])), shares: loadSharesInRange(st, from, to) }
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const SUMME_BREITE = 170

export default function JournalGridPage() {
  const [year] = useYear()
  const navigate = useNavigate()
  const days = useMemo(() => seasonDays(year), [year])
  // Zeitraum (Etappe 4): Woche (Handy-Vorgabe, E8), Monat (Desktop-Vorgabe), Saison (schmal, Überblick)
  const [spanne, setSpanne] = useState<Spanne>(() => spanneLesen(window.innerWidth >= 1024))
  const [hofOben, setHofOben] = useState(() => {
    try {
      // Vorgabe: am Desktop oben fixiert, am Handy unten (dort sind die Zeilen knapp)
      const v = localStorage.getItem('journal_raster_hof_oben')
      return v == null ? window.innerWidth >= 1024 : v === '1'
    } catch {
      return window.innerWidth >= 1024
    }
  })
  const [legende, setLegende] = useState(false)
  const [editor, setEditor] = useState<{ parcel: Parcel; date: string; neueGabe?: 'guelle' | 'mist' } | null>(null)
  const [farmDate, setFarmDate] = useState<string | null>(null)
  const [schnell, setSchnell] = useState<{ parcel: Parcel; weitere: Parcel[]; tage: string[]; ort: { x: number; y: number } } | null>(null)
  const [toast, setToast] = useState<{ text: string; rueck: () => void; n: number } | null>(null)
  // Verlauf fürs Rückgängig (Ctrl+Z, Befund U7): die letzten Schritte, nicht nur der letzte
  const verlauf = useRef<{ text: string; rueck: () => void }[]>([])
  const erfasst = useCallback((text: string, rueck: () => void) => {
    verlauf.current = [...verlauf.current.slice(-19), { text, rueck }]
    setToast((t) => ({ text, rueck: () => {
      rueck()
      verlauf.current = verlauf.current.filter((v) => v.rueck !== rueck)
    }, n: (t?.n ?? 0) + 1 }))
  }, [])
  const ablage = useRef<{ vorlage: Vorlage; text: string } | null>(null)
  const schnellZu = useCallback(() => setSchnell(null), [])
  const toastWeg = useCallback(() => setToast(null), [])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [vw, setVw] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setVw(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const labelWidth = vw < 640 ? Math.round(vw * 0.32) : 200
  const mitSumme = vw >= 1024
  // Breite der Tagesspalten: Raster in der Karte (p-3, Rand); am Desktop höchstens 1600 px
  const flaeche = Math.min(vw, 1600) - 26 - labelWidth - (mitSumme ? SUMME_BREITE : 0)
  const cellWidth = zellbreite(spanne, flaeche)

  const { data } = useQuery((pg) => loadGrid(pg, year, days[0], days[days.length - 1]), [year])

  // Finder (Etappe 1): gemeinsamer Zustand aller Ansichten; kleine Parzellen ausser bei einer Suche ausgeblendet
  const [finder, setFinder] = useGemeinsamerFinder()
  const gefunden = useGefunden(data?.parcels ?? [], finder, year)
  const parcels = gefunden.liste
  const usageByDay = useMemo(() => {
    const idx: DayIndex<UsageEntry> = {}
    for (const u of data?.usage ?? []) ((idx[u.parcel_id] ??= {})[u.entry_date] ??= []).push(u)
    return idx
  }, [data])
  // Düngung je Parzelle über die Anteile (Teilflächen erscheinen auf jeder betroffenen Zeile)
  const fertByDay = useMemo(() => {
    const idx: DayIndex<FertilizationEntry> = {}
    const byId = new Map((data?.fertilizations ?? []).map((e) => [e.id, e]))
    const withShare = new Set<string>()
    const add = (pid: string, d: string, e: FertilizationEntry) => {
      const list = ((idx[pid] ??= {})[d] ??= [])
      if (!list.some((x) => x.id === e.id)) list.push(e)
    }
    for (const { share, entry_date } of data?.shares ?? []) {
      const e = byId.get(share.entry_id)
      if (!e) continue
      withShare.add(e.id)
      add(share.parcel_id, entry_date, e)
    }
    for (const e of data?.fertilizations ?? []) if (!withShare.has(e.id) && e.parcel_id) add(e.parcel_id, e.entry_date, e)
    return idx
  }, [data])
  // Laufhof: auto = X, wenn die Kategorie an diesem Tag auf einer Weide ist
  const weideAm = useMemo(() => weideKategorien(data?.usage ?? []), [data])
  const laufhofKategorien = useMemo(() => laufhofKategorienFuer(weideAm, data?.logs ?? [], data?.ausnahmen ?? []), [data, weideAm])
  // Herden, deren abgeleitete Weide in den gewählten Zellen liegt (für «an diesem Tag nicht hier»)
  const herdenIn = (pid: string, tage: string[]) => {
    const m = new Map<string, { aufenthaltId: string; herdeId: string; name: string }>()
    for (const d of tage)
      for (const u of usageByDay[pid]?.[d] ?? [])
        if (u.herde_aufenthalt_id && !m.has(u.herde_aufenthalt_id)) {
          const a = data.stays.get(u.herde_aufenthalt_id)
          if (a) m.set(u.herde_aufenthalt_id, { aufenthaltId: a.id, herdeId: a.herde_id, name: u.animal_group ?? 'Herde' })
        }
    return [...m.values()]
  }
  const [laufhof, setLaufhof] = useState<{ kategorie: AnimalCategory; datum: string; ort: { x: number; y: number } } | null>(null)
  const logByDate = useMemo(() => Object.fromEntries((data?.logs ?? []).map((l) => [isoDate(l.entry_date), l])), [data])
  // Niederschlag automatisch von graswachstum.ch (nur auf diesem Gerät); von Hand eingetragen geht vor
  const regen = useRegen(year)
  const regenAuto = useCallback((d: string) => regenAm(regen, d), [regen])
  const regenBis = regenStand(regen[year])

  /** Tag zeigen: Woche ab Montag, Monat ab dem 1., Saison in der Mitte */
  function scrollToDay(d: string, sp: Spanne = spanne, cw = cellWidth) {
    const el = scrollRef.current
    if (!el) return
    const start = sp === 'woche' ? montag(d) : sp === 'monat' ? `${d.slice(0, 8)}01` : d
    const i = Math.max(0, days.indexOf(start) < 0 ? days.indexOf(d) : days.indexOf(start))
    el.scrollLeft = sp === 'saison' ? Math.max(0, i * cw - (el.clientWidth - labelWidth - (mitSumme ? SUMME_BREITE : 0)) / 2) : i * cw
  }
  function scrollToToday() {
    gemeinsamerTagSetzen(todayIso())
    scrollToDay(todayIso())
  }
  /** ‹ › blättert um eine Woche, einen Monat bzw. 4 Wochen */
  function blaettern(r: 1 | -1) {
    const el = scrollRef.current
    if (!el) return
    const links = days[Math.min(days.length - 1, Math.round(el.scrollLeft / cellWidth))]
    const ziel = spanne === 'monat' ? monatSprung(links, r) : addDaysIso(links, r * (spanne === 'woche' ? 7 : 28))
    const i = days.indexOf(ziel < days[0] ? days[0] : ziel > days[days.length - 1] ? days[days.length - 1] : ziel)
    el.scrollLeft = i * cellWidth
  }
  // Zeitraum wechseln: denselben Tag behalten
  function spanneWaehlen(sp: Spanne) {
    const tag = gemeinsamerTag()
    spanneMerken(sp)
    setSpanne(sp)
    requestAnimationFrame(() => scrollToDay(days.includes(tag) ? tag : todayIso(), sp, zellbreite(sp, flaeche)))
  }
  const sichtbarAb = useGemeinsamerTag()
  // Beim Öffnen: der gemeinsame Tag der Ansichten (sonst heute) in die Mitte; ausserhalb des Jahres: Saisonstart (März).
  // Nur einmal je Jahr, nicht nach jeder Änderung (sonst spränge das Raster nach jedem Speichern)
  const gescrolltFuer = useRef<number | null>(null)
  useEffect(() => {
    if (!data || gescrolltFuer.current === year || !scrollRef.current) return
    gescrolltFuer.current = year
    const tag = gemeinsamerTag()
    if (days.includes(tag)) scrollToDay(tag)
    else if (days.includes(todayIso())) scrollToDay(todayIso())
    else scrollRef.current.scrollLeft = 59 * cellWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, year])
  // Beim Blättern den Tag in der Mitte als gemeinsamen Tag merken (Heute und Jahr zeigen dann denselben Tag)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | null = null
    const on = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const i = Math.round((el.scrollLeft + (el.clientWidth - labelWidth) / 2) / cellWidth)
        if (gescrolltFuer.current === year && days[i]) gemeinsamerTagSetzen(days[i])
      }, 400)
    }
    el.addEventListener('scroll', on, { passive: true })
    return () => {
      el.removeEventListener('scroll', on)
      if (t) clearTimeout(t)
    }
  }, [days, cellWidth, labelWidth, year, parcels.length > 0])

  // Summenspalte (Desktop): Nutzungen, zuletzt genutzt, N/ha (aus dem Jahresband, Befund U3)
  const { data: kennzahlen } = useQuery((st) => (mitSumme ? jahresband(st, year, st.rows('parcels').filter((p) => p.season_year === year)).kennzahlen : null), [year, mitSumme])
  const summeText = useCallback(
    (p: Parcel) => {
      const k = kennzahlen?.get(p.id)
      if (!k) return null
      const zuletzt = k.letzteNutzung ? `${USAGE_TYPE_LETTER[k.letzteNutzung.art] ?? (k.letzteNutzung.art === 'weide' ? 'X' : '')} ${vorTagen(k.letzteNutzung.datum)}`.trim() : '–'
      return (
        <span className="truncate" title={k.letzteDuengung ? `zuletzt gedüngt ${fmtDate(k.letzteDuengung.datum)}: ${k.letzteDuengung.text}` : 'noch nicht gedüngt'} data-summe={p.name}>
          {k.nutzungen} · {zuletzt} · {k.n_kg_ha != null ? `${k.n_kg_ha} N` : '–'}
        </span>
      )
    },
    [kennzahlen],
  )

  // Tastatur wie Tabellenkalkulation (Etappe 4): Kürzel, Leeren, Kopieren, Einfügen, Füllen, Rückgängig
  const taste = useCallback(
    (a: TastenAktion, b: { pids: string[]; tage: string[] }) => {
      const s = db()
      const ps = b.pids.map((id) => s.get('parcels', id)).filter(Boolean) as Parcel[]
      if (!ps.length) return
      const wo = `${ps.length === 1 ? ps[0].name : `${ps.length} Parzellen`}${b.tage.length > 1 ? ` · ${b.tage.length} Tage` : ''}`
      if (a.art === 'rueck') {
        const v = verlauf.current.pop()
        if (v) {
          v.rueck()
          setToast(null)
        }
        return
      }
      if (a.art === 'kopieren') {
        const vorlage = kopieren(s, ps[0].id, b.tage[0])
        ablage.current = vorlage.length ? { vorlage, text: vorlage.map((u) => USAGE_TYPE_LABEL[u.usage_type] ?? u.usage_type).join(', ') } : null
        setToast((t) => ({ text: vorlage.length ? `Kopiert: ${ablage.current!.text}` : 'Nichts zu kopieren (Düngungen über den Tagesdialog)', rueck: () => {}, n: (t?.n ?? 0) + 1 }))
        return
      }
      if (a.art === 'einfuegen') {
        if (!ablage.current) return
        const r = einfuegen(s, ablage.current.vorlage, b)
        return erfasst(`${wo}: ${ablage.current.text} eingefügt`, r.rueck)
      }
      if (a.art === 'fuellen') {
        const r = fuellen(s, b)
        return r.anzahl ? erfasst(`${wo}: wie am Vortag`, r.rueck) : undefined
      }
      if (a.art === 'leeren') {
        const r = leeren(s, b)
        return r.anzahl ? erfasst(`${wo}: ${r.anzahl === 1 ? '1 Eintrag' : `${r.anzahl} Einträge`} gelöscht`, r.rueck) : undefined
      }
      const k = KUERZEL.find((x) => x.key === a.key)
      if (!k) return
      if (k.art.art === 'duengung') {
        const g = letzteGabe(s, k.art.gruppe)
        if (!g) return setEditor({ parcel: ps[0], date: b.tage[0], neueGabe: k.art.gruppe })
        const e = s.batch(() => ps.flatMap((p) => schnellErfassen(s, p, b.tage, k, { gabe: g })))
        return erfasst(`${wo}: ${gabeText(g)}`, () => rueckgaengig(db(), e))
      }
      const tiere = a.tier ? (letzteTiere(s, 12).find((t) => t.animal_category === a.tier) ?? { animal_category: a.tier, animal_group: null, animal_count: null }) : undefined
      const e = s.batch(() => ps.flatMap((p) => schnellErfassen(s, p, b.tage, k, { tiere })))
      erfasst(`${wo}: ${k.titel}${tiere ? ` ${ANIMAL_CATEGORY_LABEL[tiere.animal_category]}` : ''}`, () => rueckgaengig(db(), e))
    },
    [erfasst],
  )

  return (
    <div className="space-y-2 p-3">
      {/* kompakter Kopf (Befund R8): eine Zeile Knöpfe, Legende hinter «?», darunter der Finder */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* am Handy ohne sichtbaren Titel: der Umschalter sagt, wo man ist (Raster weiter oben, Befund U2) */}
        <h1 className="sr-only text-lg font-bold text-gray-800 sm:not-sr-only">Journal {year}</h1>
        <AnsichtUmschalter aktiv="raster" />
        {data.parcels.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
            <div className="inline-flex rounded-lg border border-gray-400 bg-white p-0.5" role="group" aria-label="Zeitraum">
              {(['woche', 'monat', 'saison'] as Spanne[]).map((sp) => (
                <button
                  key={sp}
                  type="button"
                  aria-pressed={spanne === sp}
                  data-spanne={sp}
                  className={`min-h-9 rounded-md px-1.5 text-xs sm:min-h-7 sm:px-2 ${spanne === sp ? 'bg-brand-700 font-semibold text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                  onClick={() => spanneWaehlen(sp)}
                >
                  {SPANNE_TEXT[sp]}
                </button>
              ))}
            </div>
            <button type="button" className="btn px-2.5 text-sm" onClick={() => blaettern(-1)} aria-label={`${SPANNE_TEXT[spanne]} zurück`}>
              ‹
            </button>
            <button type="button" className="btn px-2.5 text-sm" onClick={() => blaettern(1)} aria-label={`${SPANNE_TEXT[spanne]} vor`}>
              ›
            </button>
            <button type="button" className="btn px-2 text-xs" onClick={scrollToToday} aria-label="Heute">
              <span aria-hidden>📍</span>
              <span className="hidden sm:inline">Heute</span>
            </button>
            <select
              className="inp hidden min-h-10 py-1 text-xs sm:block sm:min-h-8"
              aria-label="Gehe zu Monat"
              value={Number(sichtbarAb.slice(5, 7)) - 1}
              onChange={(e) => {
                const d = `${year}-${String(Number(e.target.value) + 1).padStart(2, '0')}-01`
                gemeinsamerTagSetzen(d)
                scrollToDay(d)
              }}
            >
              {MONATE.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <button type="button" className="btn px-3 text-sm" aria-expanded={legende} aria-controls="raster-legende" aria-label="Kürzel und Farben erklären" onClick={() => setLegende((v) => !v)}>
              ?
            </button>
            <Link to="/liste" className="btn hidden px-2 text-xs sm:inline-flex">
              📋 Liste
            </Link>
          </div>
        )}
      </div>
      {data.parcels.length > 0 && legende && (
        <div id="raster-legende" className="card flex flex-wrap gap-x-3 gap-y-1 p-2 text-xs text-gray-700">
          {Object.entries(USAGE_COLOR).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} aria-hidden />
              {USAGE_COLOR_LABEL[k as keyof typeof USAGE_COLOR_LABEL]}
            </span>
          ))}
          <span>X Kühe · Y Rinder · Z Kälber · W Schafe · kleiner Buchstabe = Tagweide · Marke mit Rand = Düngung · Laufhof grau = auto</span>
          <span className="w-full" data-testid="regen-legende">
            Niederschlag <i className="text-gray-500">kursiv grau</i> = automatisch, {REGEN_QUELLE}
            {regenBis ? `, bis ${fmtDate(regenBis)}` : ' (noch keine Werte für den Standort der Parzellen)'} · <b>von Hand</b> eingetragen geht vor (Tagesmeldung)
          </span>
          <span className="w-full">Tippen: Kürzel wählen · über mehrere Tage und Parzellen ziehen (am Handy: lange drücken, dann ziehen) oder Shift+Klick · Stern: Favorit · Name: Steckbrief der Parzelle</span>
          <span className="w-full" data-testid="tasten-hilfe">
            Tastatur: Pfeile bewegen · Pos1 Name, Ende letzter Tag, Bild ↑↓ Woche · Shift+Pfeile Bereich · X Y Z W Weide (Kühe, Rinder, Kälber, Schafe), E
            Eingrasen, S Silage, B Dürrfutter belüftet, D unbelüftet, G Gülle, M Mist, P Weide putzen · Enter Kürzelleiste · Entf leeren · Ctrl+C / Ctrl+V
            kopieren, einfügen · Ctrl+R wie links · Ctrl+Z rückgängig
          </span>
          <label className="flex w-full items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={hofOben}
              onChange={(e) => {
                setHofOben(e.target.checked)
                try {
                  localStorage.setItem('journal_raster_hof_oben', e.target.checked ? '1' : '0')
                } catch {
                  // nur für diese Sitzung
                }
              }}
            />
            Laufhof, Wetter und Niederschlag oben fixiert (sonst unter den Parzellen)
          </label>
        </div>
      )}
      <StartFrage />
      {data.parcels.length > 0 && <KurznamenHinweis jahr={year} />}
      {data.parcels.length > 0 && <FinderLeiste zustand={finder} onZustand={setFinder} anzahl={parcels.length} gesamt={gefunden.gesamt} taste />}

            {data && data.parcels.length === 0 && (
        <div className="mx-auto max-w-2xl space-y-3 py-4">
          <h2 className="text-lg font-semibold text-gray-800">Willkommen im Wiesenjournal</h2>
          <p className="text-sm text-gray-600">
            Zuerst die Parzellen für {year} anlegen. Danach erscheinen sie hier im Raster, und du erfasst Nutzung und Düngung je Tag.
          </p>
          <ParzellenAnlegen variante="kacheln" mitBeispiel />
        </div>
      )}
      {parcels.length > 0 && (
        <JournalGrid
          parcels={parcels}
          gruppen={gefunden.gruppen}
          days={days}
          usageByDay={usageByDay}
          fertByDay={fertByDay}
          dailyLogByDate={logByDate}
          cellWidth={cellWidth}
          labelWidth={labelWidth}
          scrollRef={scrollRef}
          onCellClick={(parcel, date) => {
            gemeinsamerTagSetzen(date)
            setEditor({ parcel, date })
          }}
          onBereich={(parcel, a, b, ort, weitere = []) => setSchnell({ parcel, weitere, tage: tageVonBis(a, b), ort })}
          markiert={schnell ? { pids: [schnell.parcel.id, ...schnell.weitere.map((x) => x.id)], von: schnell.tage[0], bis: schnell.tage[schnell.tage.length - 1] } : null}
          onTaste={taste}
          hofOben={hofOben}
          summe={mitSumme ? summeText : undefined}
          summeTitel="Nutzungen · zuletzt · N/ha"
          summeBreite={mitSumme ? SUMME_BREITE : 0}
          onFarmCellClick={setFarmDate}
          onTagClick={(d) => {
            gemeinsamerTagSetzen(d)
            navigate(`/tag/${d}`)
          }}
          onParcelClick={(p) => navigate(`/parzelle/${p.id}`)}
          laufhofKategorien={laufhofKategorien}
          weideAm={weideAm}
          stallAm={data.stall}
          ausnahmen={data?.ausnahmen ?? []}
          onLaufhofClick={(kategorie, datum, ort) => setLaufhof({ kategorie, datum, ort })}
          regenAuto={regenBis ? regenAuto : undefined}
        />
      )}
      {gefunden.hinweis}
      {data.parcels.length > 0 && parcels.length === 0 && (
        <p className="card p-3 text-sm text-gray-700">
          Keine Parzelle passt zur Suche bzw. zu den Filtern.{' '}
          <button type="button" className="btn ml-1" onClick={() => setFinder({ suche: '', chips: [] })}>
            Zurücksetzen
          </button>
        </p>
      )}
      {editor && <DayEntryEditor parcel={editor.parcel} parcels={data?.parcels ?? []} seasonYear={year} date={editor.date} neueGabe={editor.neueGabe} onClose={() => setEditor(null)} />}
      {schnell && (
        <KuerzelLeiste
          key={`${schnell.parcel.id}|${schnell.weitere.length}|${schnell.tage[0]}|${schnell.tage.length}`}
          parcel={schnell.parcel}
          weitere={schnell.weitere}
          tage={schnell.tage}
          ort={schnell.ort}
          onClose={schnellZu}
          onDetails={(neueGabe) => {
            setEditor({ parcel: schnell.parcel, date: schnell.tage[0], neueGabe })
            setSchnell(null)
          }}
          onErfasst={erfasst}
          herden={schnell.weitere.length ? [] : herdenIn(schnell.parcel.id, schnell.tage)}
        />
      )}
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
      {farmDate && <DailyLogEditor date={farmDate} onClose={() => setFarmDate(null)} />}
      {laufhof && (
        <LaufhofMenue
          key={`${laufhof.kategorie}|${laufhof.datum}`}
          kategorie={laufhof.kategorie}
          datum={laufhof.datum}
          wert={(logByDate[laufhof.datum] as unknown as Record<string, LaufhofWert> | undefined)?.[`laufhof_${laufhof.kategorie}`] ?? null}
          aufWeide={!!weideAm.get(laufhof.datum)?.has(laufhof.kategorie)}
          stall={data.stall.get(laufhof.datum)?.get(laufhof.kategorie) ?? null}
          ort={laufhof.ort}
          onClose={() => setLaufhof(null)}
        />
      )}
    </div>
  )
}
