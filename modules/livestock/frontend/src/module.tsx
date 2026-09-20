import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Dashboard from './pages/Dashboard'
import Animals from './pages/Animals'
import AnimalDetail from './pages/AnimalDetail'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import Erfassen from './pages/Erfassen'
import WeighIn from './pages/WeighIn'
import MedicationEntry from './pages/MedicationEntry'
import MedicationReference from './pages/MedicationReference'
import FeedEntry from './pages/FeedEntry'
import FeedReference from './pages/FeedReference'
import SlaughterEntry from './pages/SlaughterEntry'
import Economics from './pages/Economics'
import History from './pages/History'
import './theme.css'

function LivestockDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

const livestockModule: ModuleDescriptor = {
  key: 'livestock',
  title: 'Mastplaner',
  icon: '🐑',
  navItems: [
    { to: '', label: 'Dashboard', icon: '🏠' },
    { to: 'tiere', label: 'Tiere', icon: '🐑' },
    { to: 'gruppen', label: 'Gruppen', icon: '📋' },
    { to: 'erfassen', label: 'Erfassen', icon: '✏️' },
    { to: 'wirtschaftlichkeit', label: 'Erlös', icon: '💰' },
  ],
  historyPermission: 'livestock:history:read',
  routes: [
    { path: '', element: <Dashboard /> },
    { path: 'tiere', element: <Animals /> },
    { path: 'tiere/:id', element: <AnimalDetail /> },
    { path: 'gruppen', element: <Groups /> },
    { path: 'gruppen/:id', element: <GroupDetail /> },
    { path: 'erfassen', element: <Erfassen /> },
    { path: 'gewichte', element: <WeighIn /> },
    { path: 'medikamente', element: <MedicationEntry /> },
    { path: 'medikamente/referenz', element: <MedicationReference /> },
    { path: 'futter', element: <FeedEntry /> },
    { path: 'futter/referenz', element: <FeedReference /> },
    { path: 'schlachtung', element: <SlaughterEntry /> },
    { path: 'wirtschaftlichkeit', element: <Economics /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: LivestockDbProvider,
  sync: syncClient,
}

export default livestockModule
