// Schematische Bilder für die CH-TAX-Schätzung am lebenden Tier (eigene Zeichnungen, keine Vorlage):
// Fleischigkeit = Keule von hinten (gewölbt bis eingezogen), Fettgewebe = Rücken im Querschnitt (Fettauflage).

import type { FatClass, Fleshiness } from '../lib/carcassValue'

export const FLESH_TEXT: Record<Fleshiness, { name: string; hint: string }> = {
  C: { name: 'sehr vollfleischig', hint: 'Keule stark gewölbt, Muskeln wölben sich über die Beckenlinie, Rücken sehr breit' },
  H: { name: 'vollfleischig', hint: 'Keule deutlich gewölbt, Rücken breit und voll' },
  '+': { name: 'ziemlich vollfleischig', hint: 'Keule leicht gewölbt, Rücken gut bemuskelt' },
  T: { name: 'mittelfleischig', hint: 'Keule gerade, Rücken mittelbreit – der Durchschnitt' },
  '-': { name: 'ziemlich leerfleischig', hint: 'Keule leicht eingezogen, Rücken eher schmal' },
  A: { name: 'leerfleischig', hint: 'Keule eingezogen, Hüfthöcker und Sitzbein treten vor' },
  X: { name: 'sehr leerfleischig', hint: 'Keule stark eingezogen, Knochen deutlich sichtbar, Rücken schmal' },
}

export const FAT_TEXT: Record<FatClass, { name: string; hint: string }> = {
  1: { name: 'ungedeckt', hint: 'Rippen und Dornfortsätze sichtbar, Schwanzansatz ohne Fett' },
  2: { name: 'teilweise gedeckt', hint: 'Rippen gut fühlbar, Schwanzansatz knapp gedeckt' },
  3: { name: 'gleichmässig gedeckt', hint: 'Rippen mit leichtem Druck fühlbar, wenig Fett am Schwanzansatz' },
  4: { name: 'stark gedeckt', hint: 'Rippen kaum fühlbar, Fettpolster am Schwanzansatz' },
  5: { name: 'sehr stark gedeckt', hint: 'Rippen nicht fühlbar, dicke Polster am Schwanzansatz und an der Brust' },
}

/** Wölbung der Keule je Klasse: +1 stark gewölbt … −1 stark eingezogen */
const BULGE: Record<Fleshiness, number> = { C: 1, H: 0.7, '+': 0.4, T: 0.12, '-': -0.2, A: -0.5, X: -0.8 }

/** Keule von hinten: Umriss vom Hüfthöcker über die Keule zum Sprunggelenk, Mitte Schwanz und Schritt. */
export function FleshPicture({ f, size = 96 }: { f: Fleshiness; size?: number }) {
  const b = BULGE[f]
  const out = 42 * b
  const lx = 44 - out
  const rx = 156 + out
  // Hüfthöcker treten bei leeren Tieren vor
  const hip = b < 0 ? 6 - b * 8 : 6
  const d = [
    'M 46 34',
    `Q ${lx} 92 64 150`,
    'L 90 150',
    `Q 100 ${118 - b * 6} 110 150`,
    'L 136 150',
    `Q ${rx} 92 154 34`,
    'Q 128 26 100 24',
    'Q 72 26 46 34',
    'Z',
  ].join(' ')
  return (
    <svg viewBox="0 0 200 165" width={size} height={(size * 165) / 200} role="img" aria-label={`Keule von hinten: ${FLESH_TEXT[f].name}`}>
      <path d={d} fill="#c98c6f" stroke="#4b3a33" strokeWidth="3" strokeLinejoin="round" />
      {/* Mittellinie zwischen den Keulen */}
      <path d={`M 100 30 Q ${100 + b * 4} 80 100 ${118 - b * 6}`} fill="none" stroke="#4b3a33" strokeWidth="2" opacity="0.6" />
      {/* Schwanz */}
      <path d="M 100 22 L 100 70" stroke="#4b3a33" strokeWidth="5" strokeLinecap="round" />
      {/* Hüfthöcker */}
      <circle cx="46" cy="34" r={hip} fill="#e9d5c8" stroke="#4b3a33" strokeWidth="2" />
      <circle cx="154" cy="34" r={hip} fill="#e9d5c8" stroke="#4b3a33" strokeWidth="2" />
    </svg>
  )
}

const FAT_MM: Record<FatClass, number> = { 1: 0, 2: 4, 3: 8, 4: 14, 5: 21 }

/** Rücken im Querschnitt: Rückenmuskel, darüber die Fettauflage, oben die Haut; Dornfortsatz in der Mitte. */
export function FatPicture({ fat, size = 96 }: { fat: FatClass; size?: number }) {
  const t = FAT_MM[fat]
  const top = 70 - t
  return (
    <svg viewBox="0 0 200 130" width={size} height={(size * 130) / 200} role="img" aria-label={`Fettauflage am Rücken: ${FAT_TEXT[fat].name}`}>
      {/* Fett */}
      {t > 0 && <path d={`M 20 120 Q 22 ${top} 100 ${top - 8} Q 178 ${top} 180 120 Z`} fill="#f2e2ae" stroke="#a88f4a" strokeWidth="2" />}
      {/* Muskel */}
      <path d="M 26 120 Q 28 72 100 64 Q 172 72 174 120 Z" fill="#b65a50" stroke="#5c2a25" strokeWidth="2" />
      {/* Dornfortsatz */}
      <path d={`M 100 120 L 100 ${fat <= 2 ? 52 : 62}`} stroke="#efe9e1" strokeWidth="7" strokeLinecap="round" />
      {/* Haut */}
      <path d={`M 14 122 Q 16 ${top - 6} 100 ${Math.min(top, 64) - 14} Q 184 ${top - 6} 186 122`} fill="none" stroke="#4b3a33" strokeWidth="3" />
      {/* Rippen bei magerem Tier sichtbar */}
      {fat === 1 && [40, 58, 142, 160].map((x) => <path key={x} d={`M ${x} 118 Q ${x + (x < 100 ? -4 : 4)} 100 ${x} 86`} fill="none" stroke="#efe9e1" strokeWidth="4" strokeLinecap="round" />)}
    </svg>
  )
}
