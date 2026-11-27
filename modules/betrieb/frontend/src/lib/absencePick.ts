// Tage im Abwesenheits-Kalender wählen (components/AbsenceCalendar.tsx) — reine Funktion, getestet.
// «einzeln»: jeder Tipp schaltet einen Tag. «von–bis»: erster Tipp = Anfang, zweiter Tipp = Ende
// (am Handy gibt es keine Shift-Taste). Shift-Klick wählt in beiden Arten den Zeitraum ab dem zuletzt
// angetippten Tag.

import { addDays } from './duty'

export type PickMode = 'einzeln' | 'bereich'

export interface PickState {
  sel: Set<string>
  /** zuletzt angetippter Tag (für Shift-Klick) */
  anchor: string | null
  /** «von–bis»: Anfang gewählt, Ende steht noch aus */
  start: string | null
}

const fill = (sel: Set<string>, a: string, b: string) => {
  const [from, to] = a <= b ? [a, b] : [b, a]
  for (let x = from; x <= to; x = addDays(x, 1)) sel.add(x)
}

export function pickDay(state: PickState, day: string, mode: PickMode, shift = false): PickState {
  const sel = new Set(state.sel)
  if (shift && state.anchor) {
    fill(sel, state.anchor, day)
    return { sel, anchor: day, start: null }
  }
  if (mode === 'bereich') {
    if (state.start) {
      fill(sel, state.start, day)
      return { sel, anchor: day, start: null }
    }
    sel.add(day)
    return { sel, anchor: day, start: day }
  }
  if (sel.has(day)) sel.delete(day)
  else sel.add(day)
  return { sel, anchor: day, start: null }
}
