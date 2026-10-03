import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { createDairySyncClient } from './db/sync'
import Milk from './pages/Milk'
import Animals from './pages/Animals'
import History from './pages/History'
import Milchwaegung from './pages/Milchwaegung'
import AnimalDetail from './pages/AnimalDetail'
import Culling from './pages/Culling'
import Erfassen from './pages/Erfassen'
import BirthEntry from './pages/BirthEntry'
import MatingEntry from './pages/MatingEntry'
import JournalEntry from './pages/JournalEntry'
import MatingPlanner from './pages/MatingPlanner'
import Pruefbericht from './pages/Pruefbericht'
import LambSelection from './pages/LambSelection'
import PedigreeAnimal from './pages/PedigreeAnimal'
import ImportPanel from './components/ImportPanel'
import { createDairyImporter, dairyFilesOf } from './lib/importDetect'
import { createDairyAnimalProvider } from './lib/animalProvider'
import './theme.css'

/**
 * Baut den ModuleDescriptor für EINE Instanz dieses Moduls. Dieses Modul
 * kann mehrfach instanziert werden (siehe core/backend/fmis_core/
 * module_registry.py, ModuleSpec.source) — z.B. `createDairyModule('dairy',
 * 'Milchkühe')` und `createDairyModule('dairy_schafe', 'Milchschafe')`
 * nebeneinander in frontend/src/App.tsx, beide mit demselben Code, aber
 * eigener pglite-Instanz/eigenem Sync-Prefix/eigenen Rechten (`key`).
 */
export function createDairyModule(key: string, title: string): ModuleDescriptor {
  function DairyDbProvider({ children }: { children: ReactNode }) {
    return <DbProvider getDb={() => getDb(key)}>{children}</DbProvider>
  }

  return {
    key,
    title,
    icon: '🥛',
    navItems: [
      { to: '', label: 'Leistung', icon: '🥛' },
      { to: 'kuehe', label: 'Tiere', icon: key === 'dairy_schafe' ? '🐑' : '🐄' },
      { to: 'erfassen', label: 'Erfassen', icon: '✏️' },
      { to: 'milchwaegung', label: 'Milchwägung', icon: '⚖️' },
      { to: 'ausmerzen', label: 'Ausmerzliste', icon: '📋' },
    ],
    historyPermission: `${key}:history:read`,
    routes: [
      { path: '', element: <Milk moduleKey={key} /> },
      { path: 'kuehe', element: <Animals moduleKey={key} /> },
      { path: 'kuehe/:id', element: <AnimalDetail moduleKey={key} /> },
      { path: 'ausmerzen', element: <Culling moduleKey={key} /> },
      { path: 'erfassen', element: <Erfassen moduleKey={key} /> },
      { path: 'geburt', element: <BirthEntry moduleKey={key} /> },
      { path: 'belegung', element: <MatingEntry moduleKey={key} /> },
      { path: 'journal', element: <JournalEntry moduleKey={key} /> },
      { path: 'anpaarung', element: <MatingPlanner moduleKey={key} /> },
      { path: 'stammbaum/:key', element: <PedigreeAnimal moduleKey={key} /> },
      { path: 'selektion', element: <LambSelection moduleKey={key} /> },
      { path: 'pruefbericht', element: <Pruefbericht moduleKey={key} /> },
      { path: 'verlauf', element: <History moduleKey={key} /> },
      { path: 'milchwaegung', element: <Milchwaegung moduleKey={key} /> },
      { path: 'melken', element: <Navigate to="../milchwaegung" replace /> },
      { path: '*', element: <Navigate to="." replace /> },
    ],
    DbProvider: DairyDbProvider,
    sync: createDairySyncClient(key),
    importer: createDairyImporter(key, title, ({ claim, ...run }) => <ImportPanel moduleKey={key} files={dairyFilesOf(claim)} {...run} />),
    animals: createDairyAnimalProvider(key, title),
  }
}
