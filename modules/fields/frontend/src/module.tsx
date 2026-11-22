import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Fields from './pages/Fields'
import Rotation from './pages/Rotation'
import History from './pages/History'
import DirectPayments from './pages/DirectPayments'
import ImportPanel from './components/ImportPanel'
import { createFieldsImporter } from './lib/importDetect'
import './theme.css'
import { fieldsYearSummary } from './lib/yearSummary'
import { statementPasteImporter } from './lib/pasteStatement'

function FieldsDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

const fieldsModule: ModuleDescriptor = {
  key: 'fields',
  title: 'Kulturen',
  icon: 'karte',
  group: 'flaechen',
  navItems: [
    { to: '', label: 'Karte', icon: 'karte' },
    { to: 'fruchtfolge', label: 'Fruchtfolge', icon: 'fruchtfolge' },
    { to: 'direktzahlungen', label: 'Direktzahlungen', icon: 'geld' },
  ],
  historyPermission: 'fields:history:read',
  routes: [
    { path: '', element: <Fields /> },
    { path: 'fruchtfolge', element: <Rotation /> },
    { path: 'direktzahlungen', element: <DirectPayments /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: FieldsDbProvider,
  sync: syncClient,
  yearSummary: fieldsYearSummary,
  importer: createFieldsImporter(ImportPanel),
  pasteImporters: [statementPasteImporter],
}

export default fieldsModule
