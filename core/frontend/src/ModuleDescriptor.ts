import type { ComponentType, ReactNode } from 'react'
import type { RouteObject } from 'react-router-dom'
import type { SyncClient } from './sync'
import type { ModuleImporter } from './upload'
import type { AnimalProvider, HerdLocator } from './animals'
import type { PasteImporter } from './pasteImport'

export interface NavItem {
  to: string
  label: string
  icon: string
}

/**
 * Was jedes Modul dem Shell (frontend/src/App.tsx) über sich mitteilt, um
 * sich selbst zu rendern/routen — gebaut aus den bereits bestehenden,
 * unveränderten Seiten/Komponenten des Moduls (siehe
 * modules/<name>/frontend/src/module.tsx). Der Shell kennt keine
 * modulspezifischen Details, nur diese Schnittstelle.
 */
export type ModuleGroup = 'tiere' | 'flaechen' | 'betrieb'

/** Kachel auf der Übersicht: 'top' ganz oben (z.B. Dienste), 'maschinen'
 * im Abschnitt «Maschinen & Betrieb». */
export interface DashboardTile {
  Tile: ComponentType
  section: 'top' | 'maschinen'
}

/** Schnellzugriff als Symbol in der Kopfzeile der Übersicht (neben Import). */
export interface QuickLink {
  to: string
  icon: string
  title: string
  /** nur mit diesem Recht sichtbar */
  permission: string
}

export interface ModuleDescriptor {
  key: string
  title: string
  icon: string
  /** Abschnitt auf der Übersicht (frontend/src/pages/Dashboard.tsx). */
  group?: ModuleGroup
  navItems: NavItem[]
  /** Permission-String fürs 📜-Icon in der Nav, z.B. "livestock:history:read". */
  historyPermission: string
  /** Relativ zu /<key>/* gemountet, siehe frontend/src/App.tsx. */
  routes: RouteObject[]
  /** Umschliesst die Routen dieses Moduls mit dessen eigener pglite-Instanz. */
  DbProvider: ComponentType<{ children: ReactNode }>
  sync: SyncClient
  /** Formate, die das Modul über die zentrale Upload-Seite übernimmt (core/frontend/src/upload.ts). */
  importer?: ModuleImporter
  /** Tiere für Herdengruppen und Standorte (core/frontend/src/animals.ts). */
  animals?: AnimalProvider
  /** Standort von Tieren in Herdengruppen (Modul Tiere). */
  herdLocator?: HerdLocator
  /** Zusätzliche Kacheln auf der Übersicht (frontend/src/pages/Dashboard.tsx),
   * z.B. Maschinen & Wartung — prüfen ihre Rechte selbst. */
  dashboardTiles?: DashboardTile[]
  /** Symbole in der Kopfzeile der Übersicht, z.B. Tracking & Fahrhilfe. */
  quickLinks?: QuickLink[]
  /** Bereiche für «Strukturierte Daten einfügen» auf der Import-Seite
   * (core/frontend/src/pasteImport.ts). */
  pasteImporters?: PasteImporter[]
  /** Liegt über allen Seiten der App (auch anderer Module), z.B. das
   * Badge einer laufenden GPS-Aufzeichnung. Prüft selbst, ob es etwas zeigt. */
  globalOverlay?: ComponentType
}
