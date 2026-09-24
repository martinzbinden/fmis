import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthUserProvider, useHasPermission } from '@fmis/core/AuthContext'
import { isLoggedIn, logout } from '@fmis/core/auth'
import Login from '@fmis/core/Login'
import VerifyToken from '@fmis/core/VerifyToken'
import CoreAdmin from '@fmis/core/Admin'
import Layout from '@fmis/core/Layout'
import { ModuleListError, cachedModules, fetchModules, type ModuleInfo } from '@fmis/core/modulesApi'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import livestockModule from '@fmis/livestock/module'
import { createDairyModule } from '@fmis/dairy/module'
import fieldsModule from '@fmis/fields/module'
import wiesenjournalModule from '@fmis/wiesenjournal/module'
import Dashboard from './pages/Dashboard'

// Statische Registry der im Frontend-Build vorhandenen Module (Pendant zu
// MODULE_SPECS in core/backend/fmis_core/module_registry.py) — welche davon
// tatsächlich aktiv sind, entscheidet zur Laufzeit GET /core/modules
// (AppShell unten), nicht diese Liste. `dairy` kann mehrfach instanziert
// werden (siehe module.tsx) — hier zwei unabhängige Instanzen für Kühe und
// Schafe, mit demselben Code aber eigenem Key/Schema/Sync-Prefix/Rechten.
const AVAILABLE_MODULES: ModuleDescriptor[] = [
  livestockModule,
  createDairyModule('dairy', 'Milchkühe'),
  createDairyModule('dairy_schafe', 'Milchschafe'),
  fieldsModule,
  wiesenjournalModule,
]

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const location = useLocation()

  // /verify muss auch OHNE bestehende Session erreichbar sein (der
  // Magic-Link-Klick tauscht den Token erst noch gegen ein Session-JWT).
  if (location.pathname === '/verify') {
    return <VerifyToken onVerified={() => setLoggedIn(true)} />
  }

  if (!loggedIn) {
    return <Login onLoggedIn={() => setLoggedIn(true)} />
  }

  return (
    <AuthUserProvider>
      <AppShell onLoggedOut={() => setLoggedIn(false)} />
    </AuthUserProvider>
  )
}

function AppShell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [moduleInfo, setModuleInfo] = useState<ModuleInfo[] | null>(null)
  const [moduleError, setModuleError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    fetchModules()
      .then((modules) => {
        if (!active) return
        setModuleInfo(modules)
        setModuleError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        console.error('Modulliste konnte nicht geladen werden', err)
        // Abgelaufene oder ungültige Anmeldung: zurück zum Login, statt mit
        // einem Token weiterzulaufen, das der Server nicht mehr akzeptiert.
        if (err instanceof ModuleListError && err.status === 401) {
          logout()
          onLoggedOut()
          return
        }
        // Sonst (kein Netz, Server weg): mit der zuletzt bekannten Liste
        // weiterarbeiten — die Module selbst liegen ohnehin lokal vor.
        const cached = cachedModules()
        if (cached) {
          setModuleInfo(cached)
          setModuleError(null)
          return
        }
        setModuleError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      active = false
    }
  }, [attempt, onLoggedOut])

  // Ohne diesen Zweig blieb der Ladekringel bei jedem Fehler für immer stehen —
  // von aussen ein weisser Schirm ohne jeden Hinweis.
  if (moduleError) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold text-red-700">App konnte nicht starten</p>
          <p className="mt-2 text-sm text-gray-600">{moduleError}</p>
          <p className="mt-1 text-xs text-gray-400">
            Beim ersten Start braucht die App einmal Verbindung; danach läuft sie offline weiter.
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-4 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Nochmals versuchen
          </button>
        </div>
      </div>
    )
  }

  if (!moduleInfo) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    )
  }

  const enabledKeys = new Set(moduleInfo.filter((m) => m.enabled).map((m) => m.key))
  const enabledModules = AVAILABLE_MODULES.filter((m) => enabledKeys.has(m.key))

  return (
    <Routes>
      <Route path="/dashboard" element={<Dashboard modules={enabledModules} onLoggedOut={onLoggedOut} />} />
      <Route
        path="/admin"
        element={
          <CoreShell onLoggedOut={onLoggedOut}>
            <CoreAdmin />
          </CoreShell>
        }
      />
      {enabledModules.map((mod) => (
        <Route key={mod.key} path={`/${mod.key}/*`} element={<ModuleRoute mod={mod} onLoggedOut={onLoggedOut} />} />
      ))}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

/** Mountet die Routen EINES Moduls unter dessen eigenem, per module.tsx
 * bereitgestellten DbProvider (eigene pglite-Instanz) und startet dessen
 * Sync-Loop — genau wie vormals AppShell pro eigenständiger App, jetzt aber
 * scoped auf /<key>/* statt die ganze App. */
function ModuleRoute({ mod, onLoggedOut }: { mod: ModuleDescriptor; onLoggedOut: () => void }) {
  useEffect(() => {
    mod.sync.startSyncLoop()
  }, [mod])

  return (
    <mod.DbProvider>
      <Layout
        moduleKey={mod.key}
        title={mod.title}
        navItems={mod.navItems}
        historyPermission={mod.historyPermission}
        sync={mod.sync}
        onLoggedOut={onLoggedOut}
      >
        <Routes>
          {mod.routes.map((r) => (
            <Route key={String(r.path)} path={r.path} element={r.element} />
          ))}
        </Routes>
      </Layout>
    </mod.DbProvider>
  )
}

/** Minimales Chrome für modulübergreifende Seiten (aktuell nur /admin) —
 * keine Modul-Bottom-Nav, nur Zurück-zur-Übersicht + Abmelden. */
function CoreShell({ children, onLoggedOut }: { children: ReactNode; onLoggedOut: () => void }) {
  const canManageUsers = useHasPermission('core:users:manage')
  const canManageModules = useHasPermission('core:modules:manage')
  if (!canManageUsers && !canManageModules) {
    return <Navigate to="/dashboard" replace />
  }
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Link to="/dashboard" className="rounded px-1 py-1 text-lg active:bg-gray-100" title="Zur Übersicht">
            🏠
          </Link>
          <span className="text-lg font-bold text-brand-800">Verwaltung</span>
        </div>
        <button
          type="button"
          onClick={() => {
            logout()
            onLoggedOut()
          }}
          className="rounded px-2 py-1 text-xs text-gray-500 active:bg-gray-100"
        >
          Abmelden
        </button>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
