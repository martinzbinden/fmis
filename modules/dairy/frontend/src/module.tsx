import type { ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import type { ModuleDescriptor } from '@fmis/core/ModuleDescriptor'
import { DbProvider } from '@fmis/core/DbContext'
import { getDb } from './db/pglite'
import { createDairySyncClient } from './db/sync'
import Milk from './pages/Milk'
import Today from './pages/Today'
import Animals from './pages/Animals'
import History from './pages/History'
import Milchwaegung from './pages/Milchwaegung'
import AnimalDetail from './pages/AnimalDetail'
import Culling from './pages/Culling'
import Erfassen from './pages/Erfassen'
import BirthEntry from './pages/BirthEntry'
import EarTagPending from './pages/EarTagPending'
import SlaughterLambs from './pages/SlaughterLambs'
import MatingEntry from './pages/MatingEntry'
import PregnancyEntry from './pages/PregnancyEntry'
import PregnancyCompare from './pages/PregnancyCompare'
import JournalEntry from './pages/JournalEntry'
import TreatmentJournal from './pages/TreatmentJournal'
import { treatmentPasteImporter } from './lib/pasteTreatments'
import MatingPlanner from './pages/MatingPlanner'
import Pruefbericht from './pages/Pruefbericht'
import LambSelection from './pages/LambSelection'
import PedigreeAnimal from './pages/PedigreeAnimal'
import AnimalInfo from './pages/AnimalInfo'
import Watchlists from './pages/Watchlists'
import ClawEntry from './pages/ClawEntry'
import GroupCompare from './pages/GroupCompare'
import Board from './pages/Board'
import Lambs from './pages/Lambs'
import ImportPanel from './components/ImportPanel'
import { createDairyImporter, dairyFilesOf } from './lib/importDetect'
import { createDairyAnimalProvider } from './lib/animalProvider'
import { speciesTerms } from './lib/species'
import { dairyYearSummary } from './lib/yearSummary'
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

  const sheep = key === 'dairy_schafe'
  const terms = speciesTerms(key)
  const sync = createDairySyncClient(key)
  return {
    key,
    title,
    // Kühe und Schafe auf der Übersicht unterscheidbar
    icon: sheep ? '🐑' : '🐄',
    group: 'tiere',
    navItems: [
      // Stall zuerst: Milchwägung und Ausmerzliste stehen auf «Heute» und im Menü «Erfassen»
      { to: '', label: 'Heute', icon: '🏠' },
      { to: 'erfassen', label: 'Erfassen', icon: '✏️' },
      { to: 'tierinfo', label: 'Tier-Info', icon: '🔎' },
      { to: 'tiere', label: 'Tiere', icon: sheep ? '🐑' : '🐄' },
      // Leistung: über Tier und Gruppe verlinkt (?tier= / ?tiere=), dazu «Heute» → Weitere Seiten
      { to: 'gruppen', label: 'Gruppen', icon: '📊' },
      // Karten je Tier in Spalten (Tiergruppen, Merklisten), am PC und Tablet
      { to: 'dashboard', label: 'Dashboard', icon: '🗂️' },
    ],
    historyPermission: `${key}:history:read`,
    pageTitles: {
      'tiere/:id': 'Tier',
      'stammbaum/:key': 'Stammbaum',
      ausmerzen: 'Ausmerzliste',
      'ausmerzen/laemmer': 'Lämmer zum Schlachttermin',
      geburt: terms.calving,
      ohrmarken: 'Ohrmarken nachtragen',
      belegung: sheep ? 'Belegung' : 'Besamung / Belegung',
      traechtigkeit: 'Trächtigkeit',
      'traechtigkeit/vergleich': 'Trächtigkeit vergleichen',
      merklisten: 'Merklisten',
      klauen: 'Klauen',
      gruppen: 'Gruppen',
      dashboard: 'Dashboard',
      laemmer: sheep ? 'Lämmer' : 'Kälber',
      leistung: 'Leistung',
      journal: 'Beobachtung / Behandlung',
      behandlungen: 'Behandlungsjournal',
      anpaarung: 'Anpaarung planen',
      selektion: sheep ? 'Lämmer-Selektion' : 'Kälber-Selektion',
      pruefbericht: 'Prüfbericht',
      milchwaegung: 'Milchwägung',
    },
    routes: [
      { path: '', element: <Today moduleKey={key} /> },
      { path: 'leistung', element: <Milk moduleKey={key} /> },
      { path: 'tiere', element: <Animals moduleKey={key} /> },
      { path: 'tiere/:id', element: <AnimalDetail moduleKey={key} /> },
      // frühere Adresse (auch für Schafe «kuehe») — gespeicherte Links und Lesezeichen
      { path: 'kuehe', element: <OldAnimalsPath moduleKey={key} /> },
      { path: 'kuehe/:id', element: <OldAnimalsPath moduleKey={key} /> },
      { path: 'ausmerzen', element: <Culling moduleKey={key} /> },
      { path: 'ausmerzen/laemmer', element: <SlaughterLambs moduleKey={key} /> },
      { path: 'erfassen', element: <Erfassen moduleKey={key} /> },
      { path: 'geburt', element: <BirthEntry moduleKey={key} /> },
      { path: 'ohrmarken', element: <EarTagPending moduleKey={key} /> },
      { path: 'belegung', element: <MatingEntry moduleKey={key} /> },
      { path: 'traechtigkeit', element: <PregnancyEntry moduleKey={key} /> },
      { path: 'traechtigkeit/vergleich', element: <PregnancyCompare /> },
      { path: 'tierinfo', element: <AnimalInfo moduleKey={key} /> },
      { path: 'merklisten', element: <Watchlists moduleKey={key} /> },
      { path: 'klauen', element: <ClawEntry moduleKey={key} /> },
      { path: 'gruppen', element: <GroupCompare moduleKey={key} /> },
      { path: 'dashboard', element: <Board moduleKey={key} /> },
      { path: 'laemmer', element: <Lambs moduleKey={key} /> },
      { path: 'journal', element: <JournalEntry moduleKey={key} /> },
      { path: 'behandlungen', element: <TreatmentJournal moduleKey={key} /> },
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
    sync,
    pasteImporters: [treatmentPasteImporter(key)],
    importer: createDairyImporter(key, title, ({ claim, ...run }) => <ImportPanel moduleKey={key} files={dairyFilesOf(claim)} {...run} />),
    animals: createDairyAnimalProvider(key, title),
    yearSummary: (year) => {
      // Daten auch ohne Besuch des Moduls aktuell halten
      sync.startSyncLoop()
      return dairyYearSummary(key, title, year)
    },
  }
}

/** /<herde>/kuehe[/id] → /<herde>/tiere[/id], mit Suchparametern und Sprungmarke. */
function OldAnimalsPath({ moduleKey }: { moduleKey: string }) {
  const { id } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`/${moduleKey}/tiere${id ? `/${id}` : ''}${search}${hash}`} replace />
}
