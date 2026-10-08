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
export interface ModuleDescriptor {
  key: string
  title: string
  icon: string
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
  /** Standort von Tieren in Herdengruppen (Wiesenjournal). */
  herdLocator?: HerdLocator
  /** Zusätzliche Kacheln auf der Übersicht (frontend/src/pages/Dashboard.tsx),
   * z.B. Maschinen & Wartung — prüfen ihre Rechte selbst. */
  dashboardTiles?: ComponentType[]
  /** Bereiche für «Strukturierte Daten einfügen» auf der Import-Seite
   * (core/frontend/src/pasteImport.ts). */
  pasteImporters?: PasteImporter[]
}
