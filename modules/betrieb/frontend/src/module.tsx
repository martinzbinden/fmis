import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Duty from './pages/Duty'
import Tracking from './pages/Tracking'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Maintenance from './pages/Maintenance'
import WorkPlan from './pages/WorkPlan'
import FarmData from './pages/FarmData'
import History from './pages/History'
import DutyTile from './components/DutyTile'
import MaintenanceTile from './components/MaintenanceTile'
import FarmDataTile from './components/FarmDataTile'
import TrackingBadge from './components/TrackingBadge'
import { maintenancePasteImporter } from './lib/pasteMaintenance'
import { dutyPasteImporter } from './lib/pasteDuty'
import './theme.css'
import { betriebYearSummary } from './lib/yearSummary'

function BetriebDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

// Betrieb: Personal (Dienstplan), Maschinen/Wartung, GPS-Tracking und
// Arbeitsplan. Flächen-Bezüge (Parzellen, Düngerarten, Journal-Einträge)
// liegen im Wiesenjournal und werden über dessen db/access gelesen/geschrieben.
const betriebModule: ModuleDescriptor = {
  key: 'betrieb',
  title: 'Betrieb',
  icon: '🏠',
  group: 'betrieb',
  navItems: [
    { to: 'dienste', label: 'Dienste', icon: '🗓️' },
    { to: 'arbeitsplan', label: 'Plan', icon: '📝' },
    { to: 'tracking', label: 'Tracking', icon: '🛰️' },
    { to: 'maschinen', label: 'Maschinen', icon: '🚜' },
    { to: 'wartung', label: 'Wartung', icon: '🔧' },
  ],
  historyPermission: 'betrieb:history:read',
  pageTitles: { betriebsdaten: 'Betriebsdaten', 'maschinen/:id': 'Maschine' },
  routes: [
    { path: '', element: <Navigate to="dienste" replace /> },
    { path: 'dienste', element: <Duty /> },
    { path: 'arbeitsplan', element: <WorkPlan /> },
    { path: 'tracking', element: <Tracking /> },
    { path: 'maschinen', element: <Machines /> },
    { path: 'maschinen/:id', element: <MachineDetail /> },
    { path: 'wartung', element: <Maintenance /> },
    { path: 'betriebsdaten', element: <FarmData /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="dienste" replace /> },
  ],
  DbProvider: BetriebDbProvider,
  sync: syncClient,
  yearSummary: betriebYearSummary,
  dashboardTiles: [
    { Tile: DutyTile, section: 'top' },
    { Tile: MaintenanceTile, section: 'maschinen' },
    { Tile: FarmDataTile, section: 'maschinen' },
  ],
  // Tracking & Fahrhilfe: Symbol oben neben dem Import statt grosser Kachel
  quickLinks: [{ to: '/betrieb/tracking', icon: '🧭', title: 'Tracking & Fahrhilfe', permission: 'betrieb:tracking:write' }],
  globalOverlay: TrackingBadge,
  pasteImporters: [maintenancePasteImporter, dutyPasteImporter],
}

export default betriebModule
