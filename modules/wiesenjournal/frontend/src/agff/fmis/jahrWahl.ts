// FMIS: Jahreswahl für die AGFF-Seiten (Jahr, Raster plus, Drucken, Fragen). Der Spiegel liest die Saison aus
// hooks/useYear, setzt sie aber nirgends – ohne Wahl liesse sich ab Neujahr das Vorjahr nicht mehr drucken.

/** Jahre mit Parzellen plus das laufende und das gewählte, aufsteigend. */
export function jahreZurWahl(saisons: (number | null | undefined)[], laufend: number, gewaehlt: number): number[] {
  const s = new Set<number>([laufend, gewaehlt])
  for (const y of saisons) if (typeof y === 'number' && y > 2000 && y < 2100) s.add(y)
  return [...s].sort((a, b) => a - b)
}

/** Tag, auf den die Ansichten beim Jahreswechsel springen: laufendes Jahr → heute, sonst gleicher Tag im Jahr. */
export function tagImJahr(tag: string, jahr: number, heute: string): string {
  if (Number(heute.slice(0, 4)) === jahr) return heute
  const md = tag.slice(5) === '02-29' ? '02-28' : tag.slice(5)
  return `${jahr}-${md}`
}
