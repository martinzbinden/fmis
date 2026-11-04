import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Herds from './pages/Herds'
import OutdoorJournal from './pages/OutdoorJournal'
import GrazingYear from './pages/GrazingYear'
import History from './pages/History'
import { herdLocator } from './lib/herds'
import { tiereYearSummary } from './lib/yearSummary'
import './theme.css'

function TiereDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

// Tiere: Herdengruppen, Standorte/Aufenthalte und Auslauf-Journal. Die
// Weidebelegung im Wiesenjournal-Raster wird aus diesen Daten abgeleitet.
const tiereModule: ModuleDescriptor = {
  key: 'tiere',
  // «Tiergruppen»: der Reiter «Tiere» in Milchkühe/Milchschafe ist etwas anderes
  title: 'Tiergruppen',
  icon: '🐾',
  group: 'tiere',
  navItems: [
    { to: '', label: 'Gruppen', icon: '🐾' },
    { to: 'auslauf', label: 'Auslauf', icon: '🌤️' },
    { to: 'weide', label: 'Weide', icon: '🌿' },
  ],
  pageTitles: { auslauf: 'Auslaufjournal', weide: 'Weidenutzung' },
  historyPermission: 'tiere:history:read',
  routes: [
    { path: '', element: <Herds /> },
    { path: 'auslauf', element: <OutdoorJournal /> },
    { path: 'weide', element: <GrazingYear /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: TiereDbProvider,
  sync: syncClient,
  herdLocator,
  yearSummary: tiereYearSummary,
}

export default tiereModule
