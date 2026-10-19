import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Projects from './pages/Projects'
import ProjectView from './pages/ProjectView'
import History from './pages/History'
import './theme.css'

function BauDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

// Bauprojekte: Leitungen, Schächte und Gebäude planen, auf der swisstopo-Karte
// einzeichnen und vor Ort per GPS einmessen; Export als KML/KMZ, DXF (LV95),
// GeoJSON, GPX und CSV. Teilt sich mit den Kulturen nur Kartendienste und
// Umrechnung (core/swisstopo.ts, core/lv95.ts); Kulturflächen werden nur
// lesend als Hintergrund gezeigt.
const bauModule: ModuleDescriptor = {
  key: 'bau',
  title: 'Bauprojekte',
  icon: '🏗️',
  group: 'betrieb',
  navItems: [{ to: '', label: 'Projekte', icon: '🏗️' }],
  historyPermission: 'bau:history:read',
  routes: [
    { path: '', element: <Projects /> },
    { path: 'projekt/:id', element: <ProjectView /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: BauDbProvider,
  sync: syncClient,
}

export default bauModule
