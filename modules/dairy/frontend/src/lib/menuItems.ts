// Alle Funktionen des Moduls für «Mehr» (pages/Erfassen.tsx) und die Suche über alles (ModuleDescriptor.functions).
// Bezeichnungen tierartenneutral (Geburt statt Ablammung/Abkalbung, Jungtiere statt Lämmer/Kälber); die alten Wörter
// stehen als Suchwörter, damit «ablammung» oder «kälber» weiterhin trifft.

import type { FunctionEntry } from '@fmis/core/search'

export interface MenuItem extends FunctionEntry {
  icon: string
  /** kurzer Titel für die Kachel «zuletzt benutzt» */
  short: string
  desc: string
}

export function menuItems(sheep: boolean, weanFromDays: number): MenuItem[] {
  const sire = sheep ? 'Widder' : 'Stier'
  return [
    { to: 'tiere', icon: 'tierliste', label: 'Tierliste', short: 'Tierliste', desc: 'Alle Tiere der Herde als Liste: suchen, filtern, Spalten wählen', keywords: 'tiere herde bestand' },
    { to: 'leistung', icon: 'milch', label: 'Leistung', short: 'Leistung', desc: 'Milchleistung und Zuchtwerte, je Tier und Gruppe', keywords: 'milch zuchtwert' },
    { to: 'tierinfo', icon: 'tierinfo', label: 'Tier-Info', short: 'Tier-Info', desc: 'Nummer tippen oder lesen: Alter, Abstammung, Index, Geburten, Belegung, Trächtigkeit, Merklisten, Verlauf', keywords: 'tier suchen nummer' },
    { to: 'geburt', icon: 'geburt', label: 'Geburt', short: 'Geburt', desc: 'Mutter, Vater, Jungtiere – Ohrmarke auch später', keywords: sheep ? 'ablammung lammen lamm' : 'abkalbung kalben kalb' },
    { to: 'ohrmarken', icon: 'ohrmarke', label: 'Ohrmarken nachtragen', short: 'Ohrmarken', desc: 'Jungtiere, die bei der Geburt noch keine Ohrmarke hatten', keywords: 'markieren' },
    { to: 'tvd', icon: 'tvd', label: 'TVD-Geburtsmeldungen', short: 'TVD', desc: 'Angaben je Jungtier für die Meldung im Agate-Portal, kopieren oder als CSV, abhaken', keywords: 'agate meldung' },
    { to: 'laemmer?aktion=absetzen', icon: 'absetzen', label: 'Absetzen', short: 'Absetzen', desc: `Saugende Jungtiere ab ${weanFromDays} Tagen wählen, in eine Jungtiergruppe zügeln`, keywords: sheep ? 'lämmer' : 'kälber' },
    { to: 'laemmer', icon: 'jungtiere', label: 'Jungtiere', short: 'Jungtiere', desc: 'Alter, Gewicht, saugend oder abgesetzt – wägen, Schoppen, Drenchen, Bolus, Behandlung für mehrere', keywords: sheep ? 'lämmer lamm' : 'kälber kalb' },
    { to: 'belegung', icon: 'belegung', label: 'Belegung', short: 'Belegung', desc: `${sire}, Datum oder Zeitraum, für mehrere Tiere`, keywords: `besamung decken ${sire.toLowerCase()} kb natursprung` },
    { to: 'traechtigkeit', icon: 'traechtig', label: 'Trächtigkeit', short: 'Trächtigkeit', desc: 'Einzeln oder mehrere Tiere (+ / Lesegerät), ja/leer/unsicher, Wochen', keywords: 'ultraschall tu leer' },
    { to: 'klauen', icon: 'klauen', label: 'Klauen', short: 'Klauen', desc: 'Befunde je Fuss, lahm, geschnitten, Behandlung – im Durchgang, mit Lesegerät', keywords: 'moderhinke klauenpflege lahm' },
    { to: 'journal', icon: 'behandlung', label: 'Beobachtung / Behandlung', short: 'Behandlung', desc: 'Krankheit, Behandlung mit Absetzfrist, Brunst, Klauen', keywords: 'krankheit tierarzt brunst medikament' },
    { to: 'milchwaegung', icon: 'waage', label: 'Milchwägung', short: 'Milchwägung', desc: 'Melkreihenfolge für die Probenahme (Lesegerät oder von Hand)', keywords: 'milchprobe probemelken melken' },
    { to: 'ausmerzen', icon: 'ausmerzen', label: 'Ausmerzliste', short: 'Ausmerzen', desc: 'Tiere mit Gründen zum Ausmerzen: Fruchtbarkeit, Euter, Leistung, Klauen', keywords: 'merzen abgang' },
    { to: 'behandlungen', icon: 'journal', label: 'Behandlungsjournal', short: 'Beh.-Journal', desc: 'Tierarzneimittel für die Kontrolle: Liste, Absetzfristen, Druck, Favoriten, cownect-Import', keywords: 'tierarzneimittel absetzfrist kontrolle tamv' },
    { to: 'selektion', icon: 'selektion', label: 'Jungtier-Selektion', short: 'Selektion', desc: 'Remonte oder Mast nach Mutterleistung, Vater und Inzucht', keywords: `remonte ${sheep ? 'lämmer' : 'kälber'}` },
    { to: 'merklisten', icon: 'merkliste', label: 'Merklisten', short: 'Merklisten', desc: 'Tiere vormerken, z.B. «Ausmerzen prüfen» – auch aus Warnungen bei der Erfassung' },
    { to: 'gruppen', icon: 'vergleich', label: 'Gruppen vergleichen', short: 'Gruppen', desc: 'Tiergruppen und Merklisten vergleichen: Leistung + Zuchtwert, Schlachterlös, Fortpflanzung, Klauen', keywords: 'vergleich' },
    { to: '/livestock/schlachtungen', icon: 'beleg', label: 'Schlachtungen', short: 'Schlachtungen', desc: 'Schlachtabrechnungen aller Tiere: Gewicht nach Alter und Laktationstagen, Preise je Taxation' },
    { to: '/import', icon: 'import', label: 'Datenimport', short: 'Import', desc: 'TVD-Tierbestand, Herdebuch- und weitere Dateien hochladen (gemeinsame Seite für alle Module)' },
    { to: 'anpaarung', icon: 'anpaarung', label: 'Anpaarung planen', short: 'Anpaarung', desc: `Erwartete Inzucht je Mutter × ${sire}`, keywords: 'inzucht' },
  ]
}

/** Pfad eines Eintrags ohne Suchteil, wie er im Verlauf «zuletzt geöffnet» steht. */
export const itemPath = (moduleKey: string, to: string) => (to.startsWith('/') ? to : `/${moduleKey}/${to}`).split('?')[0]
