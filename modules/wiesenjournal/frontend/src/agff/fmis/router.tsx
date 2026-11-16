// FMIS: react-router-dom für die gespiegelten AGFF-Dateien (tools/agff_journal.py biegt deren Import hierher um).
// Die AGFF-App läuft unter /journal/ mit Adressen wie «/tag» oder «/parzelle/…»; im FMIS liegen diese Seiten unter
// /wiesenjournal/…. Hier werden absolute Adressen umgelegt, alles andere geht unverändert an react-router-dom.
import { forwardRef } from 'react'
import * as RR from 'react-router-dom'
import type { LinkProps, NavigateFunction, NavigateOptions, NavigateProps, NavLinkProps, To } from 'react-router-dom'

export * from 'react-router-dom'

export const MODUL = '/wiesenjournal'

/** AGFF-Adresse → FMIS-Adresse. Seiten, die das FMIS selbst hat (Karte, Parzellen, Auswertung …), behalten dessen Seite. */
const UMLEITUNG: [RegExp, string][] = [
  [/^\/$/, '/heute'],
  [/^\/tag(?=\/|$|\?)/, '/heute'],
  [/^\/raster(?=$|\?)/, '/raster'],
  [/^\/liste(?=$|\?)/, '/liste'],
  [/^\/mehr(?=$|\?)/, '/mehr'],
  [/^\/herden(?=$|\?)/, '__/tiere'],
  [/^\/fahrten/, '__/betrieb/tracking'],
  [/^\/sicherung(?=$|\?)/, '__/'],
  [/^\/admin(?=$|\?)/, '__/'],
  [/^\/unkraut(?=$|\?)/, '/karte'],
]

export function fmisPfad(pfad: string): string {
  if (!pfad.startsWith('/') || pfad.startsWith(MODUL + '/') || pfad === MODUL) return pfad
  for (const [re, ziel] of UMLEITUNG) {
    if (re.test(pfad)) {
      const rest = pfad.replace(re, '')
      return ziel.startsWith('__') ? ziel.slice(2) : MODUL + ziel + rest
    }
  }
  return MODUL + pfad
}

function umlegen(to: To): To {
  if (typeof to === 'string') return fmisPfad(to)
  return to.pathname ? { ...to, pathname: fmisPfad(to.pathname) } : to
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...rest }, ref) {
  return <RR.Link ref={ref} to={umlegen(to)} {...rest} />
})

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink({ to, ...rest }, ref) {
  return <RR.NavLink ref={ref} to={umlegen(to)} {...rest} />
})

export function Navigate({ to, ...rest }: NavigateProps) {
  return <RR.Navigate to={umlegen(to)} {...rest} />
}

export function useNavigate(): NavigateFunction {
  const nav = RR.useNavigate()
  return ((to: To | number, opts?: NavigateOptions) => (typeof to === 'number' ? nav(to) : nav(umlegen(to), opts))) as NavigateFunction
}
