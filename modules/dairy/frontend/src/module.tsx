import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { createDairySyncClient } from './db/sync'
import Milk from './pages/Milk'
import Animals from './pages/Animals'
import History from './pages/History'
import Melken from './pages/Melken'
import './theme.css'

/**
 * Baut den ModuleDescriptor für EINE Instanz dieses Moduls. Dieses Modul
 * kann mehrfach instanziert werden (siehe core/backend/fmis_core/
 * module_registry.py, ModuleSpec.source) — z.B. `createDairyModule('dairy',
 * 'Milchkühe')` und `createDairyModule('dairy_schafe', 'Milchschafe')`
 * nebeneinander in frontend/src/App.tsx, beide mit demselben Code, aber
 * eigener pglite-Instanz/eigenem Sync-Prefix/eigenen Rechten (`key`).
 */
export function createDairyModule(key: string, title: string): ModuleDescriptor {
  function DairyDbProvider({ children }: { children: ReactNode }) {
    return <DbProvider getDb={() => getDb(key)}>{children}</DbProvider>
  }

  return {
    key,
    title,
    icon: '🥛',
    navItems: [
      { to: '', label: 'Leistung', icon: '🥛' },
      { to: 'kuehe', label: 'Tiere', icon: key === 'dairy_schafe' ? '🐑' : '🐄' },
      { to: 'melken', label: 'Melken', icon: '📡' },
    ],
    historyPermission: `${key}:history:read`,
    routes: [
      { path: '', element: <Milk moduleKey={key} /> },
      { path: 'kuehe', element: <Animals moduleKey={key} /> },
      { path: 'verlauf', element: <History moduleKey={key} /> },
      { path: 'melken', element: <Melken moduleKey={key} /> },
      { path: '*', element: <Navigate to="." replace /> },
    ],
    DbProvider: DairyDbProvider,
    sync: createDairySyncClient(key),
  }
}
