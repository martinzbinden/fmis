// Stallmodus (je Gerät, im Profilmenü): grössere Schrift und Tippflächen für die Bedienung mit Handschuhen, schlanke
// Kopfzeile, Bildschirm bleibt an bei laufendem Lesegerät oder Durchgang, Sperre gegen Fehlberührungen.
// Gesetzt als <html data-stall="on">; die Regeln stehen in frontend/src/index.css (Abschnitt «Stallmodus»).

import { useEffect, useSyncExternalStore } from 'react'

const KEY = 'fmis_stall_mode'
const EVENT = 'fmis-stall-mode'

export function isStallMode(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

function apply(on: boolean): void {
  if (on) document.documentElement.dataset.stall = 'on'
  else delete document.documentElement.dataset.stall
}

/** Beim Start der App einmal aufrufen (frontend/src/main.tsx). */
export function initStallMode(): void {
  apply(isStallMode())
}

export function setStallMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    // ohne Speicher: gilt bis zum Neuladen
  }
  apply(on)
  window.dispatchEvent(new Event(EVENT))
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** true im Stallmodus; Seiten können darauf z.B. eine einspaltige Ansicht wählen. */
export function useStallMode(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.stall === 'on' || isStallMode())
}

// ---- Bildschirm anlassen (Screen Wake Lock) ----

type Sentinel = { release(): Promise<void>; released?: boolean }
let sentinel: Sentinel | null = null
const holders = new Set<symbol>()

async function acquire(): Promise<void> {
  if (sentinel && !sentinel.released) return
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock
    if (wl && document.visibilityState === 'visible') sentinel = await wl.request('screen')
  } catch {
    // nicht erlaubt (z.B. Energiesparmodus) oder nicht unterstützt: Bildschirm geht wie gewohnt aus
  }
}

function release(): void {
  void sentinel?.release().catch(() => undefined)
  sentinel = null
}

if (typeof document !== 'undefined') {
  // der Browser gibt die Sperre beim Wechsel in den Hintergrund frei: beim Zurückkommen neu holen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && holders.size > 0) void acquire()
  })
}

/** Bildschirm anlassen, solange `active` (z.B. Lesegerät an, Durchgang läuft). Mehrere Seiten/Teile dürfen gleichzeitig
 * halten; erst wenn keiner mehr hält, geht er wieder aus. */
export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const me = Symbol('awake')
    holders.add(me)
    void acquire()
    return () => {
      holders.delete(me)
      if (holders.size === 0) release()
    }
  }, [active])
}
