import { Link, useLocation } from 'react-router-dom'
import { useEffect, type ReactNode } from 'react'
import { rememberView } from '../lib/lastView'

export interface View {
  /** Pfad im Modul, '' = Startseite */
  to: string
  label: string
}

/** Zwei (oder drei) Ansichten teilen sich einen Punkt der Fussleiste: Umschalter oben auf der Seite.
 * Jede Ansicht hat ihre eigene Adresse, so gehen Zurück und gespeicherte Links weiter. */
export default function ViewSwitch({ moduleKey, views, remember, children }: { moduleKey: string; views: View[]; /** Name, unter dem sich der Punkt die zuletzt benutzte Ansicht merkt (lib/lastView.ts) */ remember?: string; children: ReactNode }) {
  const { pathname } = useLocation()
  const rest = pathname.slice(moduleKey.length + 1).replace(/^\/|\/$/g, '')
  useEffect(() => {
    if (remember && views.some((v) => v.to === rest)) rememberView(moduleKey, remember, rest)
  }, [moduleKey, remember, views, rest])
  return (
    <>
      <div className="px-3 pt-3">
        <div role="tablist" className="mx-auto flex max-w-lg rounded-xl bg-gray-200 p-1">
          {views.map((v) => {
            const on = v.to === '' ? rest === '' : rest === v.to
            return (
              <Link
                key={v.to}
                to={`/${moduleKey}${v.to ? `/${v.to}` : ''}`}
                role="tab"
                aria-selected={on}
                replace
                className={`min-h-11 flex-1 content-center rounded-lg px-2 text-center text-sm ${on ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-700'}`}
              >
                {v.label}
              </Link>
            )
          })}
        </div>
      </div>
      {children}
    </>
  )
}
