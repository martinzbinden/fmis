import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Herds from './pages/Herds'
import OutdoorJournal from './pages/OutdoorJournal'
import History from './pages/History'
import { herdLocator } from './lib/herds'
import './theme.css'

function TiereDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

// Tiere: Herdengruppen, Standorte/Aufenthalte und Auslauf-Journal. Die
// Weidebelegung im Wiesenjournal-Raster wird aus diesen Daten abgeleitet.
const tiereModule: ModuleDescriptor = {
  key: 'tiere',
  title: 'Tiere',
  icon: '🐾',
  group: 'tiere',
  navItems: [
    { to: '', label: 'Herden', icon: '🐑' },
    { to: 'auslauf', label: 'Auslauf', icon: '🌤️' },
  ],
  historyPermission: 'tiere:history:read',
  routes: [
    { path: '', element: <Herds /> },
    { path: 'auslauf', element: <OutdoorJournal /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: TiereDbProvider,
  sync: syncClient,
  herdLocator,
}

export default tiereModule
