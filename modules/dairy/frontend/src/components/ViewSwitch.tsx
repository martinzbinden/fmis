import { Link, useLocation } from 'react-router-dom'
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { rememberView } from '../lib/lastView'

export interface View {
  /** Pfad im Modul, '' = Startseite */
  to: string
  label: string
}

interface Ctx {
  moduleKey: string
  views: View[]
  rest: string
}
const ViewSwitchContext = createContext<Ctx | null>(null)

function Tabs({ ctx, compact }: { ctx: Ctx; compact: boolean }) {
  return (
    <div role="tablist" className={compact ? 'flex shrink-0 rounded-lg bg-gray-200 p-0.5' : 'mx-auto flex max-w-lg rounded-xl bg-gray-200 p-1'}>
      {ctx.views.map((v) => {
        const on = v.to === '' ? ctx.rest === '' : ctx.rest === v.to
        return (
          <Link
            key={v.to}
            to={`/${ctx.moduleKey}${v.to ? `/${v.to}` : ''}`}
            role="tab"
            aria-selected={on}
            replace
            className={`content-center rounded-md text-center text-sm ${compact ? 'min-h-9 px-2.5' : 'min-h-11 flex-1 px-2'} ${on ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-700'}`}
          >
            {v.label}
          </Link>
        )
      })}
    </div>
  )
}

/** Kleiner Umschalter für Seiten, die ihn selbst platzieren (ViewSwitch mit `inline`), z.B. neben einer Auswahl. */
export function ViewTabs() {
  const ctx = useContext(ViewSwitchContext)
  return ctx ? <Tabs ctx={ctx} compact /> : null
}

/** Zwei (oder drei) Ansichten teilen sich einen Punkt der Fussleiste: Umschalter oben auf der Seite.
 * Jede Ansicht hat ihre eigene Adresse, so gehen Zurück und gespeicherte Links weiter. Mit `inline` zeichnet die Seite
 * den Umschalter selbst (ViewTabs), wo er hinpasst. */
export default function ViewSwitch({
  moduleKey,
  views,
  remember,
  inline = false,
  children,
}: {
  moduleKey: string
  views: View[]
  /** Name, unter dem sich der Punkt die zuletzt benutzte Ansicht merkt (lib/lastView.ts) */
  remember?: string
  inline?: boolean
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const rest = pathname.slice(moduleKey.length + 1).replace(/^\/|\/$/g, '')
  useEffect(() => {
    if (remember && views.some((v) => v.to === rest)) rememberView(moduleKey, remember, rest)
  }, [moduleKey, remember, views, rest])
  const ctx = { moduleKey, views, rest }
  return (
    <ViewSwitchContext.Provider value={ctx}>
      {!inline && (
        <div className="px-3 pt-3">
          <Tabs ctx={ctx} compact={false} />
        </div>
      )}
      {children}
    </ViewSwitchContext.Provider>
  )
}
