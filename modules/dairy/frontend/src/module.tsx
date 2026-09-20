import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { createDairySyncClient } from './db/sync'
import Milk from './pages/Milk'
import Animals from './pages/Animals'
import History from './pages/History'
import './theme.css'

/**
 * Baut den ModuleDescriptor für EINE Instanz dieses Moduls. Dieses Modul
 * kann mehrfach instanziert werden (siehe core/backend/fmis_core/
 * module_registry.py, ModuleSpec.source) — z.B. `createDairyModule('dairy',
 * 'Milchleistung Kühe')` und `createDairyModule('dairy_schafe', 'Milchleistung
 * Schafe')` nebeneinander in frontend/src/App.tsx, beide mit demselben Code,
 * aber eigener pglite-Instanz/eigenem Sync-Prefix/eigenen Rechten (`key`).
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
      { to: '', label: 'Milch', icon: '🥛' },
      { to: 'kuehe', label: 'Kühe', icon: '🐄' },
    ],
    historyPermission: `${key}:history:read`,
    routes: [
      { path: '', element: <Milk /> },
      { path: 'kuehe', element: <Animals /> },
      { path: 'verlauf', element: <History /> },
      { path: '*', element: <Navigate to="." replace /> },
    ],
    DbProvider: DairyDbProvider,
    sync: createDairySyncClient(key),
  }
}
