// Tierart-abhängige Begriffe pro Modul-Instanz (siehe module.tsx,
// createDairyModule): derselbe Code läuft für Milchkühe ('dairy') und
// Milchschafe ('dairy_schafe') — UI-Texte, die "Kuh" sagen, wären bei den
// Schafen falsch, und der Import ist je Instanz ein anderer (Herdebuch-
// Export vs. TVD-Tierbestand + SMG-Dateien, siehe pages/Animals.tsx).
export interface SpeciesTerms {
  /** z.B. "Kuh" */
  singular: string
  /** z.B. "Kühe" */
  plural: string
  /** Hinweis, wenn noch keine Daten da sind — verweist auf den passenden Import. */
  importHint: string
}

const TERMS: Record<string, SpeciesTerms> = {
  dairy: {
    singular: 'Kuh',
    plural: 'Kühe',
    importHint: 'Zuerst unter "Tiere" den Herdebuch-Export importieren.',
  },
  dairy_schafe: {
    singular: 'Aue',
    plural: 'Auen',
    importHint: 'Zuerst unter "Tiere" den TVD-Tierbestand und die SMG-Dateien importieren.',
  },
}

export function speciesTerms(moduleKey: string): SpeciesTerms {
  return TERMS[moduleKey] ?? { singular: 'Tier', plural: 'Tiere', importHint: 'Zuerst unter "Tiere" die Daten importieren.' }
}
