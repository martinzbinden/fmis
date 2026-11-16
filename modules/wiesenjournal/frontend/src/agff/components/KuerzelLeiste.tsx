import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../db/db'
import { getSetting } from '../db/write'
import { ANIMAL_CATEGORIES, ANIMAL_CATEGORY_LABEL, ANIMAL_CATEGORY_LETTER, fmtDate } from '../lib/format'
import { gabeText, KUERZEL, letzteGabe, letzteTiere, rueckgaengig, schnellErfassen, tiereNachfragen, WEIDE_NEU_TAGE, type Kuerzel, type Tiere } from '../lib/schnell'
import { deleteFertilizationEntry } from '../lib/fertilization'
import type { FertilizationEntry, FertilizationShare, UsageEntry } from '../types'
import { herdenStand, herdenZuruecksetzen, nichtHier } from '../lib/herden'
import type { AnimalCategory, Parcel } from '../types'

export const WEIDE_NEU_TAGE_KEY = 'schnell_weide_neu_tage'

function tageText(tage: string[]) {
  if (tage.length === 1) return fmtDate(tage[0])
  return `${fmtDate(tage[0])}–${fmtDate(tage[tage.length - 1])} · ${tage.length} Tage`
}

const tiereText = (t: Tiere) => [ANIMAL_CATEGORY_LABEL[t.animal_category], t.animal_group, t.animal_count ? `${t.animal_count} Tiere` : null].filter(Boolean).join(' · ')

/**
 * Kürzelleiste beim Tippen auf eine Rasterzelle (oder nach dem Ziehen über mehrere Tage): ein Tipp speichert sofort.
 * Beim ersten Weidegang seit N Tagen fragt sie zuerst nach den Tieren; Gülle/Mist nehmen Sorte und Menge vom letzten Mal.
 */
export default function KuerzelLeiste({
  parcel,
  weitere: weitereParzellen = [],
  tage,
  ort,
  onErfasst,
  onDetails,
  onClose,
  herden = [],
}: {
  parcel: Parcel
  /** weitere Parzellen eines Bereichs (Raster plus: Ziehen oder Shift über mehrere Zeilen); ein Kürzel gilt für alle */
  weitere?: Parcel[]
  tage: string[]
  ort: { x: number; y: number }
  /** gespeichert: Text für den Toast und wie es rückgängig geht */
  onErfasst: (text: string, rueck: () => void) => void
  /** Tagesdialog öffnen; mit `neueGabe` mit vorbereiteter Gülle- bzw. Mistgabe */
  onDetails: (neueGabe?: 'guelle' | 'mist') => void
  onClose: () => void
  /** Herden, deren Weide in diesen Zellen abgeleitet ist (Tage einzeln übersteuern) */
  herden?: { aufenthaltId: string; herdeId: string; name: string }[]
}) {
  const box = useRef<HTMLDivElement>(null)
  const [tiereFrage, setTiereFrage] = useState(false)
  const gabe = useMemo(() => ({ guelle: letzteGabe(db(), 'guelle'), mist: letzteGabe(db(), 'mist') }), [])
  const vorschlaege = useMemo(() => letzteTiere(db()), [])
  // gespeicherte Einträge dieser Zelle(n) (ohne Weide aus Herden; Düngung nur, wo die Parzelle die Gabe trägt)
  const alle = useMemo(() => [parcel, ...weitereParzellen.filter((p) => p.id !== parcel.id)], [parcel, weitereParzellen])
  const name = alle.length === 1 ? parcel.name : `${alle.length} Parzellen`
  const belegt = useMemo(() => {
    const s = db()
    const t = new Set(tage)
    const ids = new Set(alle.map((p) => p.id))
    return {
      usage: s.rows('usage_entries').filter((u) => ids.has(u.parcel_id) && t.has(u.entry_date)),
      fert: s.rows('fertilization_entries').filter((f) => !!f.parcel_id && ids.has(f.parcel_id) && t.has(f.entry_date)),
    }
  }, [alle, tage])
  // am Handy als Blatt am unteren Rand (Daumenbereich, grosse Knöpfe; Etappe 4), sonst neben der Zelle
  const unten = typeof window !== 'undefined' && window.innerWidth < 640
  const anzahlBelegt = belegt.usage.length + belegt.fert.length

  // Fokus (Befund R5): beim Öffnen auf das erste Kürzel, beim Schliessen zurück auf die Zelle
  useEffect(() => {
    const zurueck = document.activeElement instanceof HTMLElement ? document.activeElement : null
    box.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    return () => {
      if (zurueck && document.contains(zurueck) && (!document.activeElement || document.activeElement === document.body)) zurueck.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const weg = (e: Event) => box.current && !box.current.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // erst nach dem auslösenden Tipp/Ziehen scharf schalten
    const t = setTimeout(() => document.addEventListener('pointerdown', weg), 0)
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', weg)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  function speichern(k: Kuerzel, tiere?: Tiere) {
    const s = db()
    const g = k.art.art === 'duengung' ? gabe[k.art.gruppe] : null
    const erfasst = s.batch(() => alle.flatMap((p) => schnellErfassen(s, p, tage, k, { tiere, gabe: g })))
    const was = k.art.art === 'duengung' && g ? (alle.length === 1 ? gabeText(g, parcel) : gabeText(g)) : tiere ? `Weide ${tiereText(tiere)}` : k.titel
    onErfasst(`${name}: ${was}${tage.length > 1 ? ` · ${tage.length} Tage` : ''}`, () => rueckgaengig(db(), erfasst))
    onClose()
  }

  function nichtHierTippen(h: { aufenthaltId: string; herdeId: string; name: string }) {
    const stand = herdenStand(db(), [h.herdeId])
    nichtHier(db(), h.aufenthaltId, tage[0], tage[tage.length - 1])
    onErfasst(`Herde ${h.name}: ${tage.length > 1 ? `${tage.length} Tage` : 'an diesem Tag'} nicht auf ${parcel.name}`, () => herdenZuruecksetzen(db(), [h.herdeId], stand))
    onClose()
  }

  /** Einträge der Zelle löschen (Befund R7), mit Rückgängig */
  function loeschen() {
    const s = db()
    const usage: UsageEntry[] = belegt.usage
    const fert: FertilizationEntry[] = belegt.fert
    const shares: FertilizationShare[] = s.rows('fertilization_shares').filter((x) => fert.some((f) => f.id === x.entry_id))
    s.batch(() => {
      for (const u of usage) s.softDelete('usage_entries', u.id)
      for (const f of fert) deleteFertilizationEntry(s, f.id)
    })
    onErfasst(`${name}: ${anzahlBelegt === 1 ? '1 Eintrag' : `${anzahlBelegt} Einträge`} gelöscht`, () =>
      db().batch(() => {
        for (const u of usage) db().put('usage_entries', { ...u, deleted_at: null })
        for (const f of fert) db().put('fertilization_entries', { ...f, deleted_at: null })
        for (const x of shares) db().put('fertilization_shares', { ...x, deleted_at: null })
      }),
    )
    onClose()
  }

  // Pfeiltasten zwischen den Knöpfen (5 je Zeile), Tab bleibt in der Leiste
  function tasten(e: React.KeyboardEvent<HTMLDivElement>) {
    const knoepfe = [...(box.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = knoepfe.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const ziel = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 5, ArrowUp: i - 5, Home: 0, End: knoepfe.length - 1 }[e.key]
    if (ziel != null) {
      e.preventDefault()
      knoepfe[Math.max(0, Math.min(knoepfe.length - 1, ziel))]?.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      knoepfe[(i + (e.shiftKey ? -1 : 1) + knoepfe.length) % knoepfe.length]?.focus()
    }
  }

  function tippen(k: Kuerzel) {
    if (k.art.art === 'duengung' && !gabe[k.art.gruppe]) return onDetails(k.art.gruppe) // noch nie erfasst: Dialog mit vorbereiteter Gabe
    if (k.art.art === 'nutzung' && k.art.usage_type === 'weide') {
      const n = getSetting<number>(WEIDE_NEU_TAGE_KEY, WEIDE_NEU_TAGE)
      if (alle.some((p) => tiereNachfragen(db(), p.id, tage[0], n))) return setTiereFrage(true)
    }
    speichern(k)
  }

  const breite = 300
  const left = Math.max(8, Math.min(ort.x - breite / 2, window.innerWidth - breite - 8))
  const hoehe = (tiereFrage ? 300 : 190) + (anzahlBelegt ? 48 : 0)
  const top = ort.y + hoehe + 8 > window.innerHeight ? Math.max(8, ort.y - hoehe - 52) : ort.y + 8
  const weide = KUERZEL[0]
  const weitere = ANIMAL_CATEGORIES.filter((c) => !vorschlaege.some((v) => v.animal_category === c && !v.animal_group))

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Schnellerfassung ${name} ${tageText(tage)}`}
      onKeyDown={tasten}
      data-testid="kuerzel-leiste"
      data-unten={unten ? '1' : undefined}
      className={`fixed z-[1600] bg-white p-2 shadow-xl ring-1 ring-black/10 ${unten ? 'inset-x-0 bottom-0 rounded-t-2xl pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]' : 'rounded-xl'}`}
      style={unten ? undefined : { left, top, width: breite }}
    >
      <div className="mb-1.5 flex items-baseline gap-2 px-1 text-xs text-gray-500">
        <span className="truncate font-semibold text-gray-700" title={alle.map((p) => p.name).join(', ')}>
          {name}
        </span>
        <span className="ml-auto shrink-0">{tageText(tage)}</span>
      </div>
      {!tiereFrage && herden.length > 0 && (
        <div className="mb-1.5 space-y-1">
          {herden.map((h) => (
            <button
              key={h.aufenthaltId}
              type="button"
              onClick={() => nichtHierTippen(h)}
              className="flex w-full items-center gap-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-left text-xs text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
            >
              <span aria-hidden>🐄</span>
              <span className="min-w-0 flex-1 truncate">
                Herde <b>{h.name}</b>: {tage.length > 1 ? 'an diesen Tagen' : 'an diesem Tag'} nicht hier
              </span>
            </button>
          ))}
        </div>
      )}
      {!tiereFrage ? (
        <div className="grid grid-cols-5 gap-1">
          {KUERZEL.map((k) => {
            const g = k.art.art === 'duengung' ? gabe[k.art.gruppe] : null
            const unter = k.art.art === 'duengung' ? (g ? gabeText(g).replace(/^\S+\s/, '') : 'wählen') : k.kurz
            const lang = g ? gabeText(g, parcel) : ''
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => tippen(k)}
                title={k.art.art === 'duengung' ? (g ? `${k.titel}: ${lang} (je Hektare wie zuletzt)` : `${k.titel}: Sorte und Menge wählen`) : k.titel}
                aria-label={k.art.art === 'duengung' && g ? `${k.titel} ${lang}` : k.titel}
                data-kuerzel={k.key}
                className={`flex ${unten ? 'h-[58px]' : 'h-12'} flex-col items-center justify-center rounded-lg bg-gray-50 px-0.5 ring-1 ring-gray-200 hover:bg-brand-50 active:bg-brand-100`}
              >
                <span className="text-base font-bold leading-none text-brand-800">{k.label}</span>
                <span className="mt-0.5 max-w-full truncate text-[11px] leading-tight text-gray-600">{unter}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onDetails()}
            title={tage.length > 1 ? 'Alle Angaben (erster Tag)' : 'Alle Angaben'}
            aria-label="Alle Angaben"
            data-kuerzel="…"
            className={`flex ${unten ? 'h-[58px]' : 'h-12'} flex-col items-center justify-center rounded-lg bg-white ring-1 ring-gray-300 hover:bg-gray-50`}
          >
            <span className="text-base font-bold leading-none text-gray-700">…</span>
            <span className="mt-0.5 text-[11px] text-gray-600">mehr</span>
          </button>
          {anzahlBelegt > 0 && (
            <button
              type="button"
              onClick={loeschen}
              data-testid="zelle-loeschen"
              className="col-span-5 mt-1 flex h-11 items-center justify-center gap-1 rounded-lg text-sm font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-50"
            >
              {anzahlBelegt === 1 ? 'Eintrag löschen' : `${anzahlBelegt} Einträge löschen`}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5" data-testid="tiere-frage">
          <p className="px-1 text-sm font-medium text-gray-800">Welche Tiere weiden hier?</p>
          {vorschlaege.length > 0 && (
            <div className="space-y-1">
              {vorschlaege.map((t) => (
                <button
                  key={`${t.animal_category}|${t.animal_group ?? ''}`}
                  type="button"
                  onClick={() => speichern(weide, t)}
                  className="flex w-full items-center gap-2 rounded-lg bg-gray-50 px-2 py-2 text-left text-sm ring-1 ring-gray-200 hover:bg-brand-50"
                >
                  <span className="w-5 text-center font-bold text-brand-800">{ANIMAL_CATEGORY_LETTER[t.animal_category]}</span>
                  <span className="truncate">{tiereText(t)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {weitere.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => speichern(weide, { animal_category: c as AnimalCategory, animal_group: null, animal_count: null })}
                className="chip chip-off"
              >
                {ANIMAL_CATEGORY_LETTER[c]} {ANIMAL_CATEGORY_LABEL[c]}
              </button>
            ))}
            <button type="button" className="chip chip-off" onClick={() => onDetails()}>
              … Gruppe, Anzahl
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Hinweis unten mit «Rückgängig». Bleibt stehen, bis die nächste Eingabe ihn ersetzt oder er geschlossen wird (Befund R7:
 * keine Zeitgrenze).
 */
export function RueckgaengigToast({ text, onRueckgaengig, onWeg }: { text: string; onRueckgaengig: () => void; onWeg: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  // die nächste Eingabe ausserhalb schliesst den Hinweis (sonst verdeckt er Zellen am unteren Rand)
  useEffect(() => {
    const weg = (e: Event) => box.current && !box.current.contains(e.target as Node) && onWeg()
    const t = setTimeout(() => document.addEventListener('pointerdown', weg), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', weg)
    }
  }, [text, onWeg])
  return (
    <div
      ref={box}
      role="status"
      data-testid="toast"
      className="fixed inset-x-3 bottom-20 z-[1700] mx-auto flex max-w-md items-center gap-2 rounded-xl bg-gray-900 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-xl sm:bottom-6"
    >
      <span className="min-w-0 flex-1 truncate">✓ {text}</span>
      <button type="button" className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-brand-200 underline hover:bg-white/10" onClick={onRueckgaengig}>
        Rückgängig
      </button>
      <button type="button" aria-label="Hinweis schliessen" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg text-gray-300 hover:bg-white/10" onClick={onWeg}>
        ×
      </button>
    </div>
  )
}
