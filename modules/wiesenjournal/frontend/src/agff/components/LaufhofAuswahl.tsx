import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { db } from '../db/db'
import { ANIMAL_CATEGORY_LABEL, fmtDate } from '../lib/format'
import { ausnahmeSpeichern, ausnahmenAm, ausnahmeText, GRUND_LABEL, laufhofSetzen } from '../lib/laufhof'
import type { AnimalCategory, AusnahmeGrund, LaufhofWert } from '../types'

/** Auswahl direkt beim Tippen auf eine Laufhof-Zelle: auto (X bei Weide) / L / 0 / Ausnahme. */
export function LaufhofMenue({
  kategorie,
  datum,
  wert,
  aufWeide,
  stall = null,
  ort,
  onClose,
}: {
  kategorie: AnimalCategory
  datum: string
  wert: LaufhofWert
  aufWeide: boolean
  /** Herde im Stall: auto = L oder 0 */
  stall?: 'L' | '0' | null
  ort: { x: number; y: number }
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [ausnahme, setAusnahme] = useState(false)
  useEffect(() => {
    const weg = (e: Event) => box.current && !box.current.contains(e.target as Node) && !ausnahme && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', weg)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', weg)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose, ausnahme])
  // Fokus (Befund R5): beim Öffnen auf den gewählten Wert, beim Schliessen zurück auf die Zelle
  useEffect(() => {
    const zurueck = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const items = box.current?.querySelectorAll<HTMLElement>('[role=menuitemradio],[role=menuitem]')
    ;(box.current?.querySelector<HTMLElement>('[aria-checked=true]') ?? items?.[0])?.focus({ preventScroll: true })
    return () => {
      if (zurueck && document.contains(zurueck) && (!document.activeElement || document.activeElement === document.body)) zurueck.focus({ preventScroll: true })
    }
  }, [])
  const tasten = (e: React.KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitemradio],[role=menuitem]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const ziel = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key]
    if (ziel != null && i >= 0) {
      e.preventDefault()
      items[(ziel + items.length) % items.length]?.focus()
    }
  }
  const setzen = (w: LaufhofWert) => {
    laufhofSetzen(db(), datum, kategorie, w)
    onClose()
  }
  const breite = 232
  const left = Math.max(8, Math.min(ort.x - breite / 2, window.innerWidth - breite - 8))
  const top = ort.y + 220 > window.innerHeight ? Math.max(8, ort.y - 230) : ort.y + 8
  const opt = (w: LaufhofWert, zeichen: string, text: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={wert === w}
      onClick={() => setzen(w)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 ${wert === w ? 'bg-brand-100 font-semibold' : ''}`}
    >
      <span className="w-6 text-center font-mono text-base font-bold text-brand-800">{zeichen}</span>
      {text}
    </button>
  )
  if (ausnahme) return <AusnahmeDialog kategorie={kategorie} datum={datum} onClose={onClose} />
  return (
    <div
      ref={box}
      role="menu"
      aria-label={`Laufhof ${ANIMAL_CATEGORY_LABEL[kategorie]} ${fmtDate(datum)}`}
      onKeyDown={tasten}
      data-testid="laufhof-menue"
      className="fixed z-[1600] rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-black/10"
      style={{ left, top, width: breite }}
    >
      <div className="px-3 pb-1 pt-1 text-xs text-gray-500">
        {ANIMAL_CATEGORY_LABEL[kategorie]} · {fmtDate(datum)}
      </div>
      {opt(null, aufWeide ? 'X' : (stall ?? '·'), aufWeide ? 'Auto: auf Weide' : stall ? `Auto: Herde im Stall (${stall === 'L' ? 'Laufhof' : 'ohne Auslauf'})` : 'Auto (X, wenn auf Weide)')}
      {opt('L', 'L', 'Laufhof')}
      {opt('0', '0', 'kein Auslauf')}
      <button
        type="button"
        role="menuitem"
        onClick={() => setAusnahme(true)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-amber-50"
      >
        <span className="w-6 text-center text-base font-bold text-amber-700">＋</span>
        Ausnahme …
      </button>
    </div>
  )
}

/** Ausnahme vom Auslauf: Grund, Einzeltier oder Anzahl, Zeitraum. Zeigt auch die bestehenden Ausnahmen des Tages. */
export function AusnahmeDialog({ kategorie, datum, onClose }: { kategorie: AnimalCategory; datum: string; onClose: () => void }) {
  const [grund, setGrund] = useState<AusnahmeGrund>('einzeltier')
  const [freitext, setFreitext] = useState('')
  const [umfang, setUmfang] = useState<'tier' | 'anzahl' | 'alle'>('tier')
  const [tier, setTier] = useState('')
  const [anzahl, setAnzahl] = useState('')
  const [von, setVon] = useState(datum)
  const [bis, setBis] = useState(datum)
  const [, neu] = useState(0)
  const bestehend = ausnahmenAm(db().rows('auslauf_ausnahmen'), datum, kategorie)

  function speichern() {
    ausnahmeSpeichern(db(), {
      kategorie,
      grund,
      freitext: freitext.trim() || null,
      tier: umfang === 'tier' ? tier.trim() || null : null,
      anzahl: umfang === 'anzahl' && anzahl.trim() ? Number(anzahl) : null,
      von,
      bis,
    })
    onClose()
  }

  return (
    <Modal title={`Ausnahme Auslauf · ${ANIMAL_CATEGORY_LABEL[kategorie]}`} onClose={onClose} onSubmit={speichern}>
      <div className="space-y-3 text-sm" data-testid="ausnahme-dialog">
        {bestehend.length > 0 && (
          <ul className="space-y-1 rounded bg-amber-50 p-2 text-xs text-amber-900">
            {bestehend.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="flex-1">{ausnahmeText(a)}</span>
                <button
                  type="button"
                  className="text-red-700 underline"
                  onClick={() => {
                    db().softDelete('auslauf_ausnahmen', a.id)
                    neu((x) => x + 1)
                  }}
                >
                  entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <span className="mb-1 block font-medium text-gray-700">Grund</span>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(GRUND_LABEL) as AusnahmeGrund[]).map((g) => (
              <button key={g} type="button" className={`chip ${grund === g ? 'chip-on' : 'chip-off'}`} onClick={() => setGrund(g)}>
                {GRUND_LABEL[g]}
              </button>
            ))}
          </div>
          <input className="inp mt-2 w-full" placeholder="Bemerkung, z.B. Klauenbehandlung" value={freitext} onChange={(e) => setFreitext(e.target.value)} />
        </div>
        <div>
          <span className="mb-1 block font-medium text-gray-700">Betrifft</span>
          <div className="flex flex-wrap gap-1">
            {([
              ['tier', 'Einzeltier'],
              ['anzahl', 'Anzahl Tiere'],
              ['alle', `alle ${ANIMAL_CATEGORY_LABEL[kategorie]}`],
            ] as const).map(([k, t]) => (
              <button key={k} type="button" className={`chip ${umfang === k ? 'chip-on' : 'chip-off'}`} onClick={() => setUmfang(k)}>
                {t}
              </button>
            ))}
          </div>
          {umfang === 'tier' && <input className="inp mt-2 w-full" placeholder="Name oder Ohrmarke" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Einzeltier" />}
          {umfang === 'anzahl' && <input className="inp mt-2 w-28" inputMode="numeric" placeholder="Anzahl" value={anzahl} onChange={(e) => setAnzahl(e.target.value)} />}
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="block text-xs text-gray-600">von</span>
            <input type="date" className="inp w-full" value={von} onChange={(e) => setVon(e.target.value)} />
          </label>
          <label className="flex-1">
            <span className="block text-xs text-gray-600">bis</span>
            <input type="date" className="inp w-full" value={bis} onChange={(e) => setBis(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn-primary" disabled={!von || !bis} onClick={speichern}>
            Ausnahme speichern
          </button>
        </div>
      </div>
    </Modal>
  )
}
