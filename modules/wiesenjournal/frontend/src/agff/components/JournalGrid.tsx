// Raster: Parzellen × Tage (aus fmis components/JournalGrid.tsx, 59425bb). Seit Etappe 1c werden nur die sichtbaren Tage
// (plus Puffer) gezeichnet: 365 Tage × alle Parzellen als einzelne Knöpfe bremsten am Handy spürbar.
//
// Raster plus (Etappe 4, Befunde U3, U4, U9, R5, R17):
// - eine Tabelle (role="grid") mit einem einzigen Tab-Halt; Pfeiltasten über Namen, Tage und Hof-Zeilen, Pos1 = Name,
//   Ende = letzter Tag, Bild ↑/↓ = Woche; Buchstaben tippen Kürzel (X Y Z W Weide je Tierart, E S B(Db) D(Du) G(Gü)
//   M(Mi) P), Entf leert, Ctrl+C/V kopiert und fügt ein, Ctrl+R füllt «wie links», Ctrl+Z nimmt zurück;
// - Bereich über mehrere Tage und Parzellen: Shift+Pfeile, Shift+Klick, Ziehen mit der Maus (am Handy lange drücken);
// - Hof-Zeilen (Laufhof, Wetter, Niederschlag) auf Wunsch fixiert direkt unter dem Tageskopf;
// - Summenspalte rechts (Nutzungen, zuletzt, N/ha), fixiert.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from 'react'
import type { AnimalCategory, AuslaufAusnahme, DailyFarmLog, FertilizationEntry, LaufhofWert, Parcel, UsageEntry } from '../types'
import { ANIMAL_CATEGORY_LABEL, PARCEL_CATEGORY_COLOR, todayIso, usageDescription, usageLegend, USAGE_COLOR, USAGE_COLOR_FAMILY } from '../lib/format'
import { ausnahmenAm, ausnahmeText, laufhofZelle } from '../lib/laufhof'
import { Stern } from './Finder'
import { fmtRegen, REGEN_QUELLE } from '../lib/regen'
import { tageZwischen, zeilenZwischen } from '../lib/raster'

export const ROW_HEIGHT = 46
const PUFFER = 12 // Tage links und rechts ausserhalb des Sichtbereichs
const FARM_ROW_HEIGHT = 26

export interface DayIndex<T> {
  [parcelId: string]: { [date: string]: T[] }
}

/** Tastenaktion im Raster; der Bereich ist die Auswahl oder die Zelle mit dem Fokus. */
export type TastenAktion =
  | { art: 'kuerzel'; key: string; tier?: AnimalCategory }
  | { art: 'leeren' }
  | { art: 'kopieren' }
  | { art: 'einfuegen' }
  | { art: 'fuellen' }
  | { art: 'rueck' }

/** Buchstaben → Kürzel (Plan Etappe 4); X Y Z W = Weide der Tierart */
const TASTEN: Record<string, { key: string; tier?: AnimalCategory }> = {
  x: { key: 'X', tier: 'kuehe' },
  y: { key: 'X', tier: 'rinder' },
  z: { key: 'X', tier: 'kaelber' },
  w: { key: 'X', tier: 'schafe' },
  e: { key: 'E' },
  s: { key: 'S' },
  b: { key: 'Db' },
  d: { key: 'Du' },
  g: { key: 'Gü' },
  m: { key: 'Mi' },
  p: { key: 'P' },
}

const langesDatum = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'long' })

function shortDay(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return { dow: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()], dom: String(d.getDate()), first: d.getDate() === 1, weekend: d.getDay() === 0 || d.getDay() === 6 }
}

const FARM_ROWS = [
  { key: 'wetter_code', label: 'Wetter' },
  { key: 'niederschlag_mm', label: 'Niederschlag' },
] as const

type Zelle = { reihe: string; d: string } // d = 'name' für die Namensspalte
type Rechteck = { p1: string; p2: string; von: string; bis: string }

export default function JournalGrid({
  parcels,
  days,
  usageByDay,
  fertByDay,
  dailyLogByDate,
  onCellClick,
  onFarmCellClick,
  onParcelClick,
  cellWidth,
  labelWidth,
  scrollRef,
  laufhofKategorien,
  weideAm,
  stallAm,
  ausnahmen,
  onLaufhofClick,
  onBereich,
  markiert,
  onTagClick,
  gruppen,
  regenAuto,
  onTaste,
  hofOben = false,
  summe,
  summeTitel,
  summeBreite = 0,
}: {
  parcels: Parcel[]
  days: string[]
  usageByDay: DayIndex<UsageEntry>
  fertByDay: DayIndex<FertilizationEntry>
  dailyLogByDate: Record<string, DailyFarmLog>
  onCellClick: (parcel: Parcel, date: string) => void
  onFarmCellClick: (date: string) => void
  onParcelClick: (parcel: Parcel) => void
  cellWidth: number
  labelWidth: number
  scrollRef?: MutableRefObject<HTMLDivElement | null>
  /** Laufhof-Zeilen: Kategorien, Weide je Tag (für auto = X), Ausnahmen, Tippen auf eine Zelle */
  laufhofKategorien: AnimalCategory[]
  weideAm: Map<string, Set<AnimalCategory>>
  /** Laufhof auto aus Herden im Stall (L oder 0) */
  stallAm?: Map<string, Map<AnimalCategory, 'L' | '0'>>
  ausnahmen: AuslaufAusnahme[]
  onLaufhofClick: (kategorie: AnimalCategory, datum: string, ort: { x: number; y: number }) => void
  /** Tipp, Shift+Klick oder Ziehen über Tage (und Parzellen): Kürzelleiste; ohne: onCellClick */
  onBereich?: (parcel: Parcel, von: string, bis: string, ort: { x: number; y: number }, weitere?: Parcel[]) => void
  /** hervorgehobene Zellen, solange die Kürzelleiste offen ist */
  markiert?: { pids: string[]; von: string; bis: string } | null
  /** Tipp auf den Tageskopf */
  onTagClick?: (datum: string) => void
  /** Gruppen des Finders (Favoriten, Futter, Acker …) mit Kopfzeile; ohne: `parcels` ohne Gruppen */
  gruppen?: { key: string; titel: string; parcels: Parcel[] }[]
  /** automatisch geholter Niederschlag (mm) je Tag, von graswachstum.ch (lib/regen.ts); ein Eintrag von Hand geht vor */
  regenAuto?: (datum: string) => number | null
  /** Tastatur wie in einer Tabellenkalkulation (Etappe 4) */
  onTaste?: (a: TastenAktion, bereich: { pids: string[]; tage: string[] }) => void
  /** Hof-Zeilen fixiert unter dem Tageskopf statt unter den Parzellen (Befund U9) */
  hofOben?: boolean
  /** Summenspalte rechts (fixiert) */
  summe?: (p: Parcel) => ReactNode
  summeTitel?: string
  summeBreite?: number
}) {
  const eigenRef = useRef<HTMLDivElement | null>(null)
  const [bereich, setBereich] = useState<[number, number]>([0, 45])
  useLayoutEffect(() => {
    const el = eigenRef.current
    if (!el) return
    let raf = 0
    const rechnen = () => {
      raf = 0
      const von = Math.max(0, Math.floor(el.scrollLeft / cellWidth) - PUFFER)
      const bis = Math.min(days.length, Math.ceil((el.scrollLeft + el.clientWidth - labelWidth) / cellWidth) + PUFFER)
      setBereich((b) => (b[0] === von && b[1] === bis ? b : [von, bis]))
    }
    const anstossen = () => {
      if (!raf) raf = requestAnimationFrame(rechnen)
    }
    rechnen()
    el.addEventListener('scroll', anstossen, { passive: true })
    window.addEventListener('resize', anstossen)
    return () => {
      el.removeEventListener('scroll', anstossen)
      window.removeEventListener('resize', anstossen)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [cellWidth, labelWidth, days.length])

  // Reihenfolge der Zeilen (für Bereiche über mehrere Parzellen und die Pfeiltasten)
  const alleParzellen = useMemo(() => (gruppen ? gruppen.flatMap((g) => g.parcels) : parcels), [gruppen, parcels])
  const pidReihe = useMemo(() => {
    const seen = new Set<string>()
    return alleParzellen.map((p) => p.id).filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
  }, [alleParzellen])
  const hofReihen = useMemo(() => [...laufhofKategorien.map((k) => `lh:${k}`), ...FARM_ROWS.map((r) => `hof:${r.key}`)], [laufhofKategorien])
  const reihen = useMemo(() => (hofOben ? [...hofReihen, ...pidReihe] : [...pidReihe, ...hofReihen]), [hofOben, hofReihen, pidReihe])
  const parcelById = useMemo(() => new Map(alleParzellen.map((p) => [p.id, p])), [alleParzellen])

  // Ziehen über mehrere Tage und Zeilen: Maus direkt, Touch nach langem Drücken (sonst scrollt der Finger das Raster)
  const zug = useRef<{ pid: string; start: string; x: number; y: number; aktiv: boolean; touch: boolean; timer: number } | null>(null)
  const [gezogen, setGezogen] = useState<Rechteck | null>(null)
  const gezogenRef = useRef(gezogen)
  // nach dem Ziehen den folgenden Klick schlucken; das nächste Drücken hebt die Sperre auf
  const klickSperre = useRef(false)
  const zelleBei = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-p]') ?? null
  const pidReiheRef = useRef(pidReihe)
  pidReiheRef.current = pidReihe
  const parcelByIdRef = useRef(parcelById)
  parcelByIdRef.current = parcelById
  const bereichRef = useRef(onBereich)
  bereichRef.current = onBereich
  const melden = (r: Rechteck, ort: { x: number; y: number }) => {
    const pids = zeilenZwischen(pidReiheRef.current, r.p1, r.p2)
    const ps = pids.map((id) => parcelByIdRef.current.get(id)).filter(Boolean) as Parcel[]
    if (ps.length) bereichRef.current?.(ps[0], r.von, r.bis, ort, ps.slice(1))
  }
  useLayoutEffect(() => {
    const el = eigenRef.current
    if (!el || !onBereich) return
    const ende = () => {
      const z = zug.current
      if (z) clearTimeout(z.timer)
      zug.current = null
    }
    const down = (e: PointerEvent) => {
      gezogenRef.current = null
      klickSperre.current = false
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (e.shiftKey) return // Shift+Klick erweitert den Bereich (onClick)
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-p]')
      if (!c) return
      const touch = e.pointerType !== 'mouse'
      const z = { pid: c.dataset.p!, start: c.dataset.d!, x: e.clientX, y: e.clientY, aktiv: false, touch, timer: 0 }
      if (touch)
        z.timer = window.setTimeout(() => {
          if (zug.current !== z) return
          z.aktiv = true
          navigator.vibrate?.(15)
          gezogenRef.current = { p1: z.pid, p2: z.pid, von: z.start, bis: z.start }
          setGezogen(gezogenRef.current)
        }, 450)
      zug.current = z
    }
    const move = (e: PointerEvent) => {
      const z = zug.current
      if (!z) return
      if (!z.aktiv) {
        if (z.touch) {
          if (Math.hypot(e.clientX - z.x, e.clientY - z.y) > 10) ende() // wischt: Raster scrollen lassen
          return
        }
        const c = zelleBei(e.clientX, e.clientY)
        if (!c || (c.dataset.d === z.start && c.dataset.p === z.pid)) return
        z.aktiv = true
      }
      const c = zelleBei(e.clientX, e.clientY)
      const g = gezogenRef.current
      if (c && (g?.bis !== c.dataset.d || g?.p2 !== c.dataset.p)) {
        gezogenRef.current = { p1: z.pid, p2: c.dataset.p!, von: z.start, bis: c.dataset.d! }
        setGezogen(gezogenRef.current)
      }
    }
    const up = (e: PointerEvent) => {
      const z = zug.current
      ende()
      if (!z?.aktiv) return
      klickSperre.current = true
      const g = gezogenRef.current ?? { p1: z.pid, p2: z.pid, von: z.start, bis: z.start }
      gezogenRef.current = null
      setGezogen(null)
      melden(g, { x: e.clientX, y: e.clientY + 24 })
    }
    const abbruch = () => {
      ende()
      gezogenRef.current = null
      setGezogen(null)
    }
    // während des Ziehens am Touch das Scrollen unterbinden
    const touchmove = (e: TouchEvent) => {
      if (zug.current?.aktiv) e.preventDefault()
    }
    const kontext = (e: Event) => {
      if (zug.current) e.preventDefault()
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', abbruch)
    el.addEventListener('touchmove', touchmove, { passive: false })
    el.addEventListener('contextmenu', kontext)
    return () => {
      ende()
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', abbruch)
      el.removeEventListener('touchmove', touchmove)
      el.removeEventListener('contextmenu', kontext)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!onBereich])

  // ---------- Tastatur: Fokus (ein Tab-Halt) und Auswahl ----------
  const heute = todayIso()
  const [fokus, setFokus] = useState<Zelle | null>(null)
  const [auswahl, setAuswahl] = useState<Rechteck | null>(null)
  const fokusSetzen = useRef(false) // nach einer Taste den Fokus auf die neue Zelle legen
  const tagIndex = useMemo(() => new Map(days.map((d, i) => [d, i])), [days])

  const sichtbarMachen = (d: string) => {
    const el = eigenRef.current
    const i = tagIndex.get(d)
    if (!el || i == null) return
    const links = i * cellWidth
    const flaeche = el.clientWidth - labelWidth - summeBreite
    if (links < el.scrollLeft) el.scrollLeft = links
    else if (links + cellWidth > el.scrollLeft + flaeche) el.scrollLeft = links + cellWidth - flaeche
  }
  useEffect(() => {
    if (!fokusSetzen.current || !fokus) return
    const el = eigenRef.current?.querySelector<HTMLElement>(`[data-reihe="${CSS.escape(fokus.reihe)}"][data-d="${fokus.d}"]`)
    if (el) {
      fokusSetzen.current = false
      el.focus({ preventScroll: false })
    }
  })

  const bereichVon = (): { pids: string[]; tage: string[] } | null => {
    const r = auswahl ?? (fokus && !fokus.reihe.includes(':') && fokus.d !== 'name' ? { p1: fokus.reihe, p2: fokus.reihe, von: fokus.d, bis: fokus.d } : null)
    if (!r) return null
    return { pids: zeilenZwischen(pidReihe, r.p1, r.p2), tage: tageZwischen(r.von, r.bis) }
  }

  function taste(e: ReactKeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement
    const reihe = t.dataset.reihe
    const d = t.dataset.d
    if (!reihe || !d) return
    const istParzelle = !reihe.includes(':')
    const strg = e.ctrlKey || e.metaKey
    // Bewegen
    let ziel: Zelle | null = null
    const ri = reihen.indexOf(reihe)
    const di = d === 'name' ? -1 : (tagIndex.get(d) ?? 0)
    const tagBei = (i: number) => days[Math.max(0, Math.min(days.length - 1, i))]
    if (e.key === 'ArrowUp' && ri > 0) ziel = { reihe: reihen[ri - 1], d }
    else if (e.key === 'ArrowDown' && ri < reihen.length - 1) ziel = { reihe: reihen[ri + 1], d }
    else if (e.key === 'ArrowLeft') ziel = di <= 0 ? (istParzelle ? { reihe, d: 'name' } : { reihe, d: days[0] }) : { reihe, d: tagBei(di - 1) }
    else if (e.key === 'ArrowRight') ziel = { reihe, d: tagBei(di + 1) }
    else if (e.key === 'PageUp') ziel = { reihe, d: tagBei(di - 7) }
    else if (e.key === 'PageDown') ziel = { reihe, d: tagBei(di + 7) }
    else if (e.key === 'Home') ziel = strg ? { reihe: reihen[0], d } : { reihe, d: istParzelle ? 'name' : days[0] }
    else if (e.key === 'End') ziel = strg ? { reihe: reihen[reihen.length - 1], d } : { reihe, d: days[days.length - 1] }
    if (ziel) {
      e.preventDefault()
      if (ziel.d === 'name' && ziel.reihe.includes(':')) ziel = { reihe: ziel.reihe, d: days[0] }
      if (ziel.d !== 'name') sichtbarMachen(ziel.d)
      // Shift: Bereich aufziehen (nur Parzellen und Tage)
      if (e.shiftKey && istParzelle && !ziel.reihe.includes(':') && ziel.d !== 'name' && d !== 'name') {
        const a = auswahl ?? { p1: reihe, p2: reihe, von: d, bis: d }
        setAuswahl({ ...a, p2: ziel.reihe, bis: ziel.d })
      } else if (!e.shiftKey) setAuswahl(null)
      fokusSetzen.current = true
      setFokus(ziel)
      return
    }
    if (e.key === 'Escape' && auswahl) {
      e.preventDefault()
      setAuswahl(null)
      return
    }
    if (!onTaste || !istParzelle || d === 'name') return
    const b = bereichVon()
    if (!b) return
    const k = e.key.toLowerCase()
    let a: TastenAktion | null = null
    if (strg && k === 'c') a = { art: 'kopieren' }
    else if (strg && k === 'v') a = { art: 'einfuegen' }
    else if (strg && k === 'r') a = { art: 'fuellen' }
    else if (strg && k === 'z') a = { art: 'rueck' }
    else if (!strg && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) a = { art: 'leeren' }
    else if (!strg && !e.altKey && TASTEN[k]) a = { art: 'kuerzel', key: TASTEN[k].key, tier: TASTEN[k].tier }
    if (a) {
      e.preventDefault()
      onTaste(a, b)
    }
  }

  // Tab-Halt: die Zelle mit dem Fokus, sonst die erste sichtbare Zelle der ersten Parzelle
  const [von, bis] = bereich
  const tabZelle: Zelle | null = fokus && (fokus.d === 'name' || ((tagIndex.get(fokus.d) ?? -1) >= von && (tagIndex.get(fokus.d) ?? -1) < bis)) ? fokus : pidReihe[0] ? { reihe: pidReihe[0], d: days[Math.max(von, Math.min(bis - 1, tagIndex.get(heute) ?? von))] } : null
  const tab = (reihe: string, d: string) => (tabZelle && tabZelle.reihe === reihe && tabZelle.d === d ? 0 : -1)
  // Shift+Klick: Die Zelle bekommt beim Drücken schon den Fokus; der Anker (Fokus) soll dabei bleiben
  const shiftZeiger = useRef(false)
  const fokusVon = (reihe: string, d: string) => () => {
    if (shiftZeiger.current) return
    if (!fokus || fokus.reihe !== reihe || fokus.d !== d) setFokus({ reihe, d })
  }

  const hell: Rechteck | null = gezogen ?? auswahl ?? (markiert ? { p1: markiert.pids[0], p2: markiert.pids[markiert.pids.length - 1], von: markiert.von, bis: markiert.bis } : null)
  const hellPids = useMemo(() => (hell ? new Set(zeilenZwischen(pidReihe, hell.p1, hell.p2)) : new Set<string>()), [hell, pidReihe])
  const [hv, hb] = hell ? (hell.von <= hell.bis ? [hell.von, hell.bis] : [hell.bis, hell.von]) : ['', '']

  const links = von * cellWidth
  const rechts = (days.length - bis) * cellWidth
  const alleMeta = useMemo(() => days.map((d) => ({ d, ...shortDay(d) })), [days])
  const meta = alleMeta.slice(von, bis)
  const sichtbareTage = days.slice(von, bis)
  const luecke = (w: number) => (w > 0 ? <div className="shrink-0" style={{ width: w }} aria-hidden /> : null)
  const summenZelle = (inhalt: ReactNode, kopf = false) =>
    summe ? (
      <div
        role={kopf ? 'columnheader' : 'gridcell'}
        className={`sticky right-0 z-10 flex shrink-0 items-center border-l border-gray-300 px-2 text-xs ${kopf ? 'bg-white font-semibold text-gray-600' : 'bg-white text-gray-700'}`}
        style={{ width: summeBreite }}
      >
        {inhalt}
      </div>
    ) : null

  const zeile = (p: Parcel) => (
    <div key={p.id} role="row" className={`flex border-b ${p.category === 'acker' ? 'bg-amber-50/40' : ''}`}>
      <div role="rowheader" className={`sticky left-0 z-10 flex shrink-0 items-center ${p.category === 'acker' ? 'bg-amber-50' : 'bg-white'}`} style={{ width: labelWidth, height: ROW_HEIGHT }}>
        {/* im Raster kein eigener Tab-Halt (eine Tabelle, ein Tab-Halt); Favoriten per Tastatur in der Parzellenliste */}
        <Stern parcel={p} tabbar={false} />
        <button
          type="button"
          onClick={() => onParcelClick(p)}
          title={`${p.name}${p.kultur_name_de ? ' · ' + p.kultur_name_de : ''} – Steckbrief`}
          aria-label={`${p.name}${p.area_a != null ? `, ${Number(p.area_a).toFixed(0)} a` : ''}: Steckbrief`}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-2 text-left text-xs font-medium text-gray-800"
          data-reihe={p.id}
          data-d="name"
          tabIndex={tab(p.id, 'name')}
          onFocus={fokusVon(p.id, 'name')}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PARCEL_CATEGORY_COLOR[p.category] }} aria-hidden />
          <span className="min-w-0 flex-1">
            {/* einzeilig (Wunsch des Betriebs 16.11.2026); lange Namen kürzt man mit «Kürzere Namen vorschlagen» */}
            <span className="block truncate leading-tight">{p.name}</span>
            <span className="block truncate text-[11px] font-normal text-gray-600">
              {p.area_a != null ? `${Number(p.area_a).toFixed(0)} a` : ''}
              {p.wiesentyp ? ` · ${p.wiesentyp}` : ''}
            </span>
          </span>
        </button>
      </div>
      {luecke(links)}
      {meta.map(({ d, first, weekend }) => {
        const usage = usageByDay[p.id]?.[d] ?? []
        const fert = fertByDay[p.id]?.[d] ?? []
        const badge = usage.map(usageLegend).join('')
        const color = usage[0] ? USAGE_COLOR[USAGE_COLOR_FAMILY[usage[0].usage_type] ?? 'sonstig'] : undefined
        const title = [
          ...usage.map(usageDescription),
          ...fert.map((f) => `${f.code}${f.amount != null ? ` ${Number(f.amount)} ${f.unit === 'm3' ? 'm³' : f.unit}` : ''}${f.incomplete ? ' (unvollständig)' : ''}`),
        ].join('\n')
        const markiertHier = hellPids.has(p.id) && d >= hv && d <= hb
        return (
          <button
            key={d}
            type="button"
            role="gridcell"
            aria-label={`${p.name}, ${langesDatum(d)}: ${title ? title.replace(/\n/g, '; ') : 'leer'}`}
            aria-selected={markiertHier ? true : undefined}
            onClick={(e) => {
              if (klickSperre.current) return void (klickSperre.current = false)
              if (!onBereich) return onCellClick(p, d)
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const ort = { x: r.left + r.width / 2, y: r.bottom }
              // Shift+Klick: Bereich von der Zelle mit dem Fokus bis hier
              shiftZeiger.current = false
              if (e.shiftKey && fokus && !fokus.reihe.includes(':') && fokus.d !== 'name') {
                const rr = { p1: fokus.reihe, p2: p.id, von: fokus.d, bis: d }
                setAuswahl(rr)
                return melden(rr, ort)
              }
              setAuswahl(null)
              setFokus({ reihe: p.id, d })
              onBereich(p, d, d, ort)
            }}
            title={title || undefined}
            data-cell={`${p.name}|${d}`}
            data-p={p.id}
            data-d={d}
            data-reihe={p.id}
            tabIndex={tab(p.id, d)}
            onFocus={fokusVon(p.id, d)}
            className={`flex shrink-0 select-none flex-col items-center justify-center overflow-hidden [-webkit-touch-callout:none] hover:bg-brand-50 ${first ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'} ${
              markiertHier ? 'bg-brand-100 ring-2 ring-inset ring-brand-600' : d === heute ? 'bg-yellow-200/60' : weekend ? 'bg-gray-50' : ''
            }`}
            style={{ width: cellWidth, height: ROW_HEIGHT }}
          >
            {badge && (
              <span className={`font-bold leading-tight ${badge.length > 2 ? 'text-[11px]' : 'text-[13px]'}`} style={{ color }} aria-hidden>
                {badge}
              </span>
            )}
            {fert.length > 0 && (
              // Düngung als Marke mit Rand (Form und Farbe, Befund R3); Menge im Namen der Zelle und im Dialog
              <span
                aria-hidden
                className={`mt-0.5 max-w-full truncate rounded border px-0.5 text-[11px] font-semibold leading-tight ${
                  fert.some((f) => f.incomplete) ? 'border-amber-600 bg-amber-200 text-amber-950' : 'border-amber-700 bg-amber-50 text-amber-800'
                }`}
              >
                {fert.map((f) => f.code).join(' ')}
              </span>
            )}
          </button>
        )
      })}
      {luecke(rechts)}
      {summenZelle(summe?.(p))}
    </div>
  )

  const hofZeilen = (
    <>
      {laufhofKategorien.map((kat) => (
        <div key={kat} role="row" className="flex border-b bg-gray-50">
          <div role="rowheader" className="sticky left-0 z-10 flex shrink-0 items-center bg-gray-50 px-2 text-xs font-medium text-gray-700" style={{ width: labelWidth, height: FARM_ROW_HEIGHT }}>
            Laufhof {ANIMAL_CATEGORY_LABEL[kat]}
          </div>
          {luecke(links)}
          {sichtbareTage.map((d) => {
            const z = laufhofZelle(dailyLogByDate[d]?.[`laufhof_${kat}` as keyof DailyFarmLog] as LaufhofWert, !!weideAm.get(d)?.has(kat), ausnahmenAm(ausnahmen, d, kat), stallAm?.get(d)?.get(kat))
            const titel = [z.auto && z.zeichen ? (z.zeichen === 'X' ? 'X auto (Weide laut Journal)' : `${z.zeichen} auto (Herde im Stall)`) : z.zeichen ? { X: 'X Weide', L: 'L Laufhof', '0': '0 kein Auslauf' }[z.zeichen] : 'auto', ...z.ausnahmen.map(ausnahmeText)].join('\n')
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  onLaufhofClick(kat, d, { x: r.left + r.width / 2, y: r.bottom })
                }}
                title={titel}
                aria-label={`Laufhof ${ANIMAL_CATEGORY_LABEL[kat]}, ${langesDatum(d)}: ${titel.replace(/\n/g, '; ')}`}
                data-laufhof={`${kat}|${d}`}
                data-reihe={`lh:${kat}`}
                data-d={d}
                tabIndex={tab(`lh:${kat}`, d)}
                onFocus={fokusVon(`lh:${kat}`, d)}
                className={`relative shrink-0 border-l border-gray-100 text-center text-xs hover:bg-brand-50 ${
                  // auto grau und kursiv, von Hand gesetzt fett (Befund R4)
                  z.auto ? 'italic text-gray-600' : z.zeichen === '0' ? 'font-bold text-red-700' : 'font-bold text-brand-800'
                } ${d === heute ? 'bg-yellow-200/60' : ''}`}
                style={{ width: cellWidth, height: FARM_ROW_HEIGHT }}
              >
                <span aria-hidden>{z.zeichen}</span>
                {z.ausnahmen.length > 0 && (
                  <span aria-hidden className="absolute right-0.5 top-0 text-[11px] font-bold leading-none text-[#b45309]">
                    !
                  </span>
                )}
              </button>
            )
          })}
          {luecke(rechts)}
          {summenZelle(null)}
        </div>
      ))}

      {FARM_ROWS.map((row) => (
        <div key={row.key} role="row" className="flex border-b bg-gray-50">
          <div
            role="rowheader"
            className="sticky left-0 z-10 flex shrink-0 flex-col justify-center bg-gray-50 px-2 text-xs font-medium leading-none text-gray-700"
            style={{ width: labelWidth, height: FARM_ROW_HEIGHT }}
            title={row.key === 'niederschlag_mm' && regenAuto ? `Niederschlag in mm. Grau: automatisch, ${REGEN_QUELLE}. Schwarz: von Hand eingetragen, geht vor.` : undefined}
          >
            {row.label}
            {row.key === 'niederschlag_mm' && regenAuto && (
              <span className="mt-0.5 truncate text-[9px] font-normal italic text-gray-500" data-testid="regen-quelle">
                grau: MeteoSchweiz
              </span>
            )}
          </div>
          {luecke(links)}
          {sichtbareTage.map((d) => {
            const log = dailyLogByDate[d]
            const v = log?.[row.key as keyof DailyFarmLog]
            const regen = row.key === 'niederschlag_mm'
            // Niederschlag: von Hand eingetragen geht vor, sonst der automatische Wert (grau; trockene Tage bleiben leer)
            const auto = regen && v == null ? (regenAuto?.(d) ?? null) : null
            const content = v != null ? String(regen ? Number(v) : v) : auto ? fmtRegen(auto) : null
            const sprechen = v != null ? `${content}${regen ? ' mm' : ''}` : auto != null ? `${fmtRegen(auto)} mm, automatisch (${REGEN_QUELLE})` : 'leer'
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                onClick={() => onFarmCellClick(d)}
                aria-label={`${row.label}, ${langesDatum(d)}: ${sprechen}`}
                title={auto != null ? `${fmtRegen(auto)} mm · ${REGEN_QUELLE}` : undefined}
                data-farm-cell={`${row.key}|${d}`}
                data-auto={auto != null ? '1' : undefined}
                data-reihe={`hof:${row.key}`}
                data-d={d}
                tabIndex={tab(`hof:${row.key}`, d)}
                onFocus={fokusVon(`hof:${row.key}`, d)}
                className={`shrink-0 truncate border-l border-gray-100 text-center text-[11px] hover:bg-brand-50 ${auto != null ? 'italic text-gray-500' : 'font-medium text-gray-800'} ${d === heute ? 'bg-yellow-200/60' : ''}`}
                style={{ width: cellWidth, height: FARM_ROW_HEIGHT }}
              >
                {content}
              </button>
            )
          })}
          {luecke(rechts)}
          {summenZelle(null)}
        </div>
      ))}
    </>
  )

  return (
    <div
      ref={(el) => {
        eigenRef.current = el
        if (scrollRef) scrollRef.current = el
      }}
      role="grid"
      aria-label="Raster: Parzellen und Tage. Pfeiltasten bewegen, Buchstaben tragen Kürzel ein, Entf leert, Shift+Pfeile wählt einen Bereich."
      aria-rowcount={reihen.length + 1}
      className="card overflow-auto"
      style={{ maxHeight: 'max(20rem, calc(100dvh - 15rem))' }}
      data-testid="raster"
      data-zellbreite={cellWidth}
      data-erster-tag={days[0]}
      onKeyDown={taste}
      onPointerDownCapture={(e) => (shiftZeiger.current = e.shiftKey)}
      data-fokus={fokus ? `${fokus.reihe}|${fokus.d}` : undefined}
    >
      <div style={{ minWidth: labelWidth + days.length * cellWidth + summeBreite }}>
        {/* Kopf: Tage, darunter auf Wunsch die Hof-Zeilen; fixiert beim senkrechten Rollen */}
        <div className="sticky top-0 z-30 bg-white" role="rowgroup">
          <div className="flex border-b bg-white" role="row">
            <div role="columnheader" className="sticky left-0 z-20 flex shrink-0 items-end bg-white px-2 pb-1 text-xs font-semibold text-gray-600" style={{ width: labelWidth }}>
              Parzelle
            </div>
            {luecke(links)}
            {meta.map(({ d, dow, dom, first, weekend }) => (
              <button
                type="button"
                role="columnheader"
                key={d}
                tabIndex={-1}
                onClick={() => onTagClick?.(d)}
                title="Tageskarte öffnen"
                aria-label={`Tageskarte ${langesDatum(d)}${d === heute ? ' (heute)' : ''}`}
                data-tag-kopf={d}
                className={`shrink-0 pt-1 text-center text-[11px] leading-tight text-gray-600 hover:bg-brand-50 ${first ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'} ${
                  d === heute ? 'bg-yellow-300/70 font-bold text-gray-900' : weekend ? 'bg-gray-100 text-gray-700' : ''
                }`}
                style={{ width: cellWidth }}
              >
                {first && <div className="font-semibold text-gray-700">{new Date(d + 'T00:00:00').toLocaleDateString('de-CH', { month: 'short' })}</div>}
                <div>{dow}</div>
                <div>{dom}</div>
              </button>
            ))}
            {luecke(rechts)}
            {summenZelle(summeTitel, true)}
          </div>
          {hofOben && hofZeilen}
        </div>

        {(gruppen ?? [{ key: 'alle', titel: '', parcels }]).map((g) => (
          <div key={g.key} role="rowgroup" aria-label={g.titel || undefined}>
            {g.titel && (
              <div className="flex border-b bg-gray-100" data-gruppe={g.key} role="row">
                <div role="rowheader" className="sticky left-0 z-10 bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700" style={{ width: labelWidth }}>
                  {g.titel} · {g.parcels.length}
                </div>
              </div>
            )}
            {g.parcels.map((p) => zeile(p))}
          </div>
        ))}

        {!hofOben && <div role="rowgroup">{hofZeilen}</div>}
      </div>
    </div>
  )
}
