import { useEffect, useState, type ChangeEvent, type InputHTMLAttributes } from 'react'

// Zahlenfeld für Handy und Büro — Ersatz für <input type="number">:
//  - inputMode zeigt den Ziffernblock (dezimal bzw. ganzzahlig),
//  - Komma wird akzeptiert und zu Punkt («3,5» → 3.5; lehnt das
//    je nach Browser/Sprache ab),
//  - das Mausrad verändert den Wert nicht mehr (Datenfehler am Desktop),
//  - Buchstaben und doppelte Punkte werden verhindert.
// Funktioniert mit Text- UND Zahl-State: das Feld führt seinen Text selbst
// mit («12.» bleibt stehen) und gleicht nur bei echter Wertänderung ab.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

const asText = (v: unknown) => (v == null ? '' : String(v))
const same = (a: string, b: string) => {
  if (a === b) return true
  const x = Number(a.replace(',', '.'))
  const y = Number(b.replace(',', '.'))
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && x === y
}

/** Nur Ziffern, ein Dezimalpunkt, Minus am Anfang. */
export function cleanNumber(raw: string): string {
  let s = raw.replace(/,/g, '.').replace(/[^0-9.-]/g, '')
  const neg = s.startsWith('-')
  s = s.replace(/-/g, '')
  const dot = s.indexOf('.')
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  return neg ? `-${s}` : s
}

export default function NumberInput({ value, onChange, step, inputMode, ...rest }: Props) {
  const [text, setText] = useState(asText(value))

  useEffect(() => {
    const next = asText(value)
    setText((cur) => (same(cur, next) ? cur : next))
  }, [value])

  const integer = step != null && Number.isInteger(Number(step))
  function handle(e: ChangeEvent<HTMLInputElement>) {
    const clean = cleanNumber(e.target.value)
    if (clean !== e.target.value) e.target.value = clean
    setText(clean)
    onChange?.(e)
  }

  return (
    <input
      autoComplete="off"
      enterKeyHint="next"
      {...rest}
      type="text"
      inputMode={inputMode ?? (integer ? 'numeric' : 'decimal')}
      value={text}
      onChange={handle}
    />
  )
}
