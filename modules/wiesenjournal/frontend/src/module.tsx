import { lazy, Suspense, type ReactNode } from 'react'
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
import AgffSeite from './agff/fmis/AgffSeite'
// Seiten aus dem AGFF-Wiesenjournal (Spiegel agff/, tools/agff_journal.py), nur bei Bedarf geladen
const TagPage = lazy(() => import('./agff/pages/TagPage'))
const RasterPlus = lazy(() => import('./agff/pages/JournalGridPage'))
const JahrPage = lazy(() => import('./agff/pages/JahrPage'))
const SteckbriefPage = lazy(() => import('./agff/pages/SteckbriefPage'))
const DruckPage = lazy(() => import('./agff/pages/DruckPage'))
const FragenPage = lazy(() => import('./agff/pages/FragenPage'))
const MorePage = lazy(() => import('./agff/pages/MorePage'))

function Agff({ children }: { children: ReactNode }) {
  return (
    <AgffSeite>
      <Suspense fallback={<p className="p-4 text-sm text-gray-600">Seite wird geladen …</p>}>{children}</Suspense>
    </AgffSeite>
  )
}
import { wiesenjournalYearSummary } from './lib/yearSummary'
import { searchParcels } from './lib/search'

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
  icon: 'wiese',
  group: 'flaechen',
  navItems: [
    { to: 'heute', label: 'Heute', icon: 'sonne' },
    { to: '', label: 'Raster', icon: 'raster' },
    { to: 'jahr', label: 'Jahr', icon: 'jahr' },
    { to: 'karte', label: 'Karte', icon: 'karte' },
    { to: 'mehr', label: 'Mehr', icon: 'mehr' },
  ],
  historyPermission: 'wiesenjournal:history:read',
  search: searchParcels,
  pageTitles: {
    duengerarten: 'Düngerarten',
    heute: 'Heute',
    raster: 'Raster plus',
    jahr: 'Jahr',
    'parzelle/:id': 'Steckbrief',
    'heute/:datum': 'Heute',
    druck: 'Drucken',
    fragen: 'Suchen und Fragen',
    mehr: 'Mehr',
    liste: 'Journal',
    parzellen: 'Parzellen',
    auswertung: 'Auswertung',
  },
  routes: [
    { path: '', element: <JournalGrid /> },
    { path: 'liste', element: <Journal /> },
    { path: 'karte', element: <Map /> },
    { path: 'parzellen', element: <Parcels /> },
    { path: 'auswertung', element: <Report /> },
    { path: 'verlauf', element: <History /> },
    { path: 'heute', element: <Agff><TagPage /></Agff> },
    { path: 'heute/:datum', element: <Agff><TagPage /></Agff> },
    { path: 'raster', element: <Agff><RasterPlus /></Agff> },
    { path: 'jahr', element: <Agff><JahrPage /></Agff> },
    { path: 'parzelle/:id', element: <Agff><SteckbriefPage /></Agff> },
    { path: 'druck', element: <Agff><DruckPage /></Agff> },
    { path: 'fragen', element: <Agff><FragenPage /></Agff> },
    { path: 'mehr', element: <Agff><MorePage /></Agff> },
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
  yearSummary: wiesenjournalYearSummary,
}

export default wiesenjournalModule
