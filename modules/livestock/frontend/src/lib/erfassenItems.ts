// Kacheln der Seite «Erfassen». Eigene Datei, damit ein Test jedes Ziel gegen
// die Routen in module.tsx prüfen kann (erfassenItems.test.ts). Absolute Pfade
// mit /livestock/…: die App hat keinen basename, ein «/gewichte» führte ins Leere.

export interface ErfassenItem {
  to: string
  icon: string
  label: string
  desc: string
}

export const ERFASSEN_ITEMS: ErfassenItem[] = [
  { to: '/livestock/gewichte', icon: 'waage', label: 'Gewichte erfassen', desc: 'Schnellerfassung pro Gruppe' },
  { to: '/livestock/medikamente', icon: 'behandlung', label: 'Medikamente erfassen', desc: 'Pro Tier oder ganze Gruppe' },
  { to: '/livestock/futter', icon: 'wiese', label: 'Futter erfassen', desc: 'Pro Gruppe' },
  {
    to: '/livestock/schlachtung',
    icon: 'beleg',
    label: 'Schlachtung erfassen (Masttier)',
    desc: 'Ein Tier aus dem Mastplaner: Schlachtresultat mit Erlös, Tier wird «geschlachtet» und verlässt seine Gruppe. Zählt für Erlös und Wirtschaftlichkeit.',
  },
  {
    to: '/livestock/schlachtungen',
    icon: 'beleg',
    label: 'Schlachtungen (Abrechnungen)',
    desc: 'Alle Tiere aus den Schlachtabrechnungen, auch Schafe und Rinder: Abrechnung einfügen, Gewicht nach Alter, Jahreszeit, Taxation.',
  },
  { to: '/livestock/mastauswertung', icon: 'geld', label: 'Mastauswertung', desc: 'Lämmer: Tageszunahmen, Futterverzehr, Futterverwertung, Deckungsbeitrag' },
]
