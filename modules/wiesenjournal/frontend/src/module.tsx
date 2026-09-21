import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import JournalGrid from './pages/JournalGrid'
import Journal from './pages/Journal'
import Map from './pages/Map'
import Parcels from './pages/Parcels'
import Report from './pages/Report'
import History from './pages/History'
import FertilizerTypes from './pages/FertilizerTypes'
import './theme.css'

function WiesenjournalDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

const wiesenjournalModule: ModuleDescriptor = {
  key: 'wiesenjournal',
  title: 'Wiesenjournal',
  icon: '🌾',
  navItems: [
    { to: '', label: 'Raster', icon: '📅' },
    { to: 'liste', label: 'Journal', icon: '📋' },
    { to: 'karte', label: 'Karte', icon: '🗺️' },
    { to: 'parzellen', label: 'Parzellen', icon: '🌱' },
    { to: 'auswertung', label: 'Auswertung', icon: '📊' },
  ],
  historyPermission: 'wiesenjournal:history:read',
  routes: [
    { path: '', element: <JournalGrid /> },
    { path: 'liste', element: <Journal /> },
    { path: 'karte', element: <Map /> },
    { path: 'parzellen', element: <Parcels /> },
    { path: 'auswertung', element: <Report /> },
    { path: 'verlauf', element: <History /> },
    // Kein Nav-Eintrag (Bottom-Bar ist voll) — verlinkt von Parzellen/Auswertung.
    { path: 'duengerarten', element: <FertilizerTypes /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: WiesenjournalDbProvider,
  sync: syncClient,
}

export default wiesenjournalModule
