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
import TvdBirths from './pages/TvdBirths'
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
import { GROUP_VIEWS, GROUP_VIEW_TOPIC, lastGroupView } from './lib/groupViews'
import Stall from './pages/Stall'
import Lambs from './pages/Lambs'
import ImportPanel from './components/ImportPanel'
import { createDairyImporter, dairyFilesOf } from './lib/importDetect'
import { createDairyAnimalProvider } from './lib/animalProvider'
import { speciesTerms } from './lib/species'
import { dairyYearSummary } from './lib/yearSummary'
import LastCapture from './components/LastCapture'
import ViewSwitch, { type View } from './components/ViewSwitch'
import { captureNavItem } from './lib/lastCapture'
import type { NavItem } from '@fmis/core/ModuleDescriptor'
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
  // Zwei Ansichten je Punkt der Fussleiste (ViewSwitch) und Erfassungsseiten, die sich der dynamische Punkt merkt
  const HOME: View[] = [{ to: '', label: 'Heute' }, { to: 'stall', label: 'Kalender' }]
  // Gruppen: Karten links (Vorgabe beim ersten Besuch), danach die zuletzt benutzte Ansicht (lib/groupViews.ts)
  const GROUPS: View[] = GROUP_VIEWS
  const views = (v: View[], el: ReactNode, remember?: string) => <ViewSwitch moduleKey={key} views={v} remember={remember}>{el}</ViewSwitch>
  const capture = (path: string, el: ReactNode) => <LastCapture moduleKey={key} path={path}>{el}</LastCapture>
  const sync = createDairySyncClient(key)
  return {
    key,
    title,
    // Kühe und Schafe auf der Übersicht unterscheidbar
    icon: sheep ? '🐑' : '🐄',
    group: 'tiere',
    // Fussleiste: höchstens 5 Punkte (Handy). Zwei Ansichten teilen sich je einen Punkt (Umschalter oben, ViewSwitch).
    navItems: [
      // Heute + Kalender (Stall)
      { to: '', label: 'Heute', icon: '🏠', also: ['stall'] },
      // nur Tier-Info; vom Einzeltier führt ein Sprung in seine Gruppe (components/GroupJump.tsx), die Tierliste steht unter «Mehr»
      { to: 'tierinfo', label: 'Tier', icon: sheep ? '🐑' : '🐄', also: ['tiere', 'kuehe'] },
      // Karten + Vergleich: öffnet die zuletzt benutzte Ansicht
      { ...groupsNavItem(key), resolve: () => groupsNavItem(key) },
      // zuletzt benutzte Erfassungsfunktion (lib/lastCapture.ts)
      { ...captureNavItem(key, sheep), resolve: () => captureNavItem(key, sheep) },
      // alle weiteren Funktionen und Seiten
      { to: 'mehr', label: 'Mehr', icon: '☰', also: ['erfassen', 'leistung', 'laemmer', 'ausmerzen', 'behandlungen', 'anpaarung', 'selektion', 'merklisten', 'pruefbericht', 'stammbaum'] },
    ],
    historyPermission: `${key}:history:read`,
    pageTitles: {
      'tiere/:id': 'Tier',
      'stammbaum/:key': 'Stammbaum',
      ausmerzen: 'Ausmerzliste',
      'ausmerzen/laemmer': 'Lämmer zum Schlachttermin',
      geburt: terms.calving,
      ohrmarken: 'Ohrmarken nachtragen',
      tvd: 'TVD-Geburtsmeldungen',
      belegung: sheep ? 'Belegung' : 'Besamung / Belegung',
      traechtigkeit: 'Trächtigkeit',
      'traechtigkeit/vergleich': 'Trächtigkeit vergleichen',
      merklisten: 'Merklisten',
      klauen: 'Klauen',
      gruppen: 'Gruppen',
      dashboard: 'Karten',
      stall: 'Kalender',
      mehr: 'Mehr',
      tierinfo: 'Tier-Info',
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
      { path: '', element: views(HOME, <Today moduleKey={key} />) },
      { path: 'leistung', element: <Milk moduleKey={key} /> },
      { path: 'tiere', element: <Animals moduleKey={key} /> },
      { path: 'tiere/:id', element: <AnimalDetail moduleKey={key} /> },
      // frühere Adresse (auch für Schafe «kuehe») — gespeicherte Links und Lesezeichen
      { path: 'kuehe', element: <OldAnimalsPath moduleKey={key} /> },
      { path: 'kuehe/:id', element: <OldAnimalsPath moduleKey={key} /> },
      { path: 'ausmerzen', element: <Culling moduleKey={key} /> },
      { path: 'ausmerzen/laemmer', element: <SlaughterLambs moduleKey={key} /> },
      { path: 'erfassen', element: <Erfassen moduleKey={key} /> },
      { path: 'mehr', element: <Erfassen moduleKey={key} /> },
      { path: 'geburt', element: capture('geburt', <BirthEntry moduleKey={key} />) },
      { path: 'ohrmarken', element: capture('ohrmarken', <EarTagPending moduleKey={key} />) },
      { path: 'tvd', element: capture('tvd', <TvdBirths moduleKey={key} />) },
      { path: 'belegung', element: capture('belegung', <MatingEntry moduleKey={key} />) },
      { path: 'traechtigkeit', element: capture('traechtigkeit', <PregnancyEntry moduleKey={key} />) },
      { path: 'traechtigkeit/vergleich', element: <PregnancyCompare /> },
      { path: 'tierinfo', element: <AnimalInfo moduleKey={key} /> },
      { path: 'merklisten', element: <Watchlists moduleKey={key} /> },
      { path: 'klauen', element: capture('klauen', <ClawEntry moduleKey={key} />) },
      { path: 'gruppen', element: views(GROUPS, <GroupCompare moduleKey={key} />, GROUP_VIEW_TOPIC) },
      { path: 'dashboard', element: views(GROUPS, <Board moduleKey={key} />, GROUP_VIEW_TOPIC) },
      { path: 'stall', element: views(HOME, <Stall moduleKey={key} />) },
      { path: 'laemmer', element: <Lambs moduleKey={key} /> },
      { path: 'journal', element: capture('journal', <JournalEntry moduleKey={key} />) },
      { path: 'behandlungen', element: <TreatmentJournal moduleKey={key} /> },
      { path: 'anpaarung', element: <MatingPlanner moduleKey={key} /> },
      { path: 'stammbaum/:key', element: <PedigreeAnimal moduleKey={key} /> },
      { path: 'selektion', element: <LambSelection moduleKey={key} /> },
      { path: 'pruefbericht', element: <Pruefbericht moduleKey={key} /> },
      { path: 'verlauf', element: <History moduleKey={key} /> },
      { path: 'milchwaegung', element: capture('milchwaegung', <Milchwaegung moduleKey={key} />) },
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

/** Fussleisten-Punkt «Gruppen»: öffnet die zuletzt benutzte Ansicht (Vorgabe Karten). */
function groupsNavItem(moduleKey: string): NavItem {
  return { to: lastGroupView(moduleKey), label: 'Gruppen', icon: '📊', also: GROUP_VIEWS.map((v) => v.to) }
}

/** /<herde>/kuehe[/id] → /<herde>/tiere[/id], mit Suchparametern und Sprungmarke. */
function OldAnimalsPath({ moduleKey }: { moduleKey: string }) {
  const { id } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`/${moduleKey}/tiere${id ? `/${id}` : ''}${search}${hash}`} replace />
}
