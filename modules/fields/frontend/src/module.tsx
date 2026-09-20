import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { syncClient } from './db/sync'
import Fields from './pages/Fields'
import Rotation from './pages/Rotation'
import History from './pages/History'
import './theme.css'

function FieldsDbProvider({ children }: { children: ReactNode }) {
  return <DbProvider getDb={getDb}>{children}</DbProvider>
}

const fieldsModule: ModuleDescriptor = {
  key: 'fields',
  title: 'Kulturen',
  icon: '🗺️',
  navItems: [
    { to: '', label: 'Karte', icon: '🗺️' },
    { to: 'fruchtfolge', label: 'Fruchtfolge', icon: '🔄' },
  ],
  historyPermission: 'fields:history:read',
  routes: [
    { path: '', element: <Fields /> },
    { path: 'fruchtfolge', element: <Rotation /> },
    { path: 'verlauf', element: <History /> },
    { path: '*', element: <Navigate to="." replace /> },
  ],
  DbProvider: FieldsDbProvider,
  sync: syncClient,
}

export default fieldsModule
