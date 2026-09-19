import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Milk from './pages/Milk'
import Animals from './pages/Animals'
import History from './pages/History'
import './theme.css'

function DairyDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

const dairyModule: ModuleDescriptor = {
  key: 'dairy',
  title: 'Milchleistung',
  icon: '🥛',
  navItems: [
    { to: '', label: 'Milch', icon: '🥛' },
    { to: 'kuehe', label: 'Kühe', icon: '🐄' },
  ],
  historyPermission: 'dairy:history:read',
  routes: [
    { path: '', element: <Milk /> },
    { path: 'kuehe', element: <Animals /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: DairyDbProvider,
  sync: syncClient,
}

export default dairyModule
