import { useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

/** Tier, zu dem eine Liste springen soll (?tier=<id>, z.B. aus der Tier-Info). */
export function useJumpTarget(): string | null {
  const [params] = useSearchParams()
  return params.get('tier')
}

/** Scrollt nach dem Laden zum Element mit dieser id (Listenzeile oder Abschnitt).
 * Ohne `elementId` gilt der #Anker der Adresse — React Router springt nicht selbst dorthin. */
export function useJumpTo(ready: boolean, elementId?: string | null): void {
  const { hash } = useLocation()
  const target = elementId ?? (hash ? decodeURIComponent(hash.slice(1)) : null)
  useEffect(() => {
    if (!ready || !target) return
    // Die Liste wächst nach dem Laden noch (weitere Abfragen, Bilder) — mehrmals
    // nachziehen, bis die Zeile oben steht; ohne Animation, die bräche dabei ab.
    let done = false
    const timers = [100, 400, 1000, 2000].map((ms) =>
      setTimeout(() => {
        const el = document.getElementById(target)
        if (!el || done) return
        const top = el.getBoundingClientRect().top
        if (Math.abs(top - 80) > 8) el.scrollIntoView({ block: 'start' })
        else done = true
      }, ms),
    )
    const stop = () => (done = true)
    // wer selbst scrollt, gewinnt
    window.addEventListener('touchstart', stop, { once: true })
    window.addEventListener('wheel', stop, { once: true })
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('wheel', stop)
    }
  }, [ready, target])
}
