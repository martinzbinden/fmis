import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
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

// Bis 2026-10 lagen Dienste, Tracking, Maschinen, Arbeitsplan und Herden im
// Wiesenjournal. Alte Links/Lesezeichen (auch Mail-/Kalender-Links) leiten
// weiter — Suchparameter bleiben erhalten.
function Moved({ to }: { to: string }) {
  const { search } = useLocation()
  const { id } = useParams()
  return <Navigate to={to.replace(':id', id ?? '') + search} replace />
}

function WiesenjournalDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

const wiesenjournalModule: ModuleDescriptor = {
  key: 'wiesenjournal',
  title: 'Wiesenjournal',
  icon: '🌾',
  group: 'flaechen',
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
    { path: 'tracking', element: <Moved to="/betrieb/tracking" /> },
    { path: 'dienste', element: <Moved to="/betrieb/dienste" /> },
    { path: 'arbeitsplan', element: <Moved to="/betrieb/arbeitsplan" /> },
    { path: 'maschinen', element: <Moved to="/betrieb/maschinen" /> },
    { path: 'maschinen/:id', element: <Moved to="/betrieb/maschinen/:id" /> },
    { path: 'wartung', element: <Moved to="/betrieb/wartung" /> },
    { path: 'herden', element: <Moved to="/tiere" /> },
    { path: 'auslauf', element: <Moved to="/tiere/auslauf" /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: WiesenjournalDbProvider,
  sync: syncClient,
}

export default wiesenjournalModule
