// Symbole der App (Satz «Kachel»): weisses Zeichen auf einer Kachel in der Farbe des Themas. Gezeichnet auf einem
// 24er-Raster, Strich 2, Akzent als halbweisse Fläche. Module geben in `icon` einen Namen aus ICONS an; unbekannte
// Werte (z.B. Emojis aus «Meine Links» oder alte Einträge «zuletzt geöffnet») erscheinen unverändert als Text.

import type { ReactNode } from 'react'

/** Farbe je Thema; Maschinen, Flächen und Bau mit eigenen Farben */
export const ICON_THEMES = {
  app: '#5F5E5A',
  tiere: '#0F6E56',
  zucht: '#993556',
  gesundheit: '#185FA5',
  maschinen: '#854F0B',
  flaechen: '#3B6D11',
  dienste: '#534AB7',
  bau: '#993C1D',
} as const
export type IconTheme = keyof typeof ICON_THEMES

/** Grau der Fussleiste für nicht gewählte Punkte */
export const ICON_MUTED = '#B4B2A9'

// Bausteine: m = Linie, a = Fläche (halbweiss) mit Linie, l = Akzentlinie
type Part = ['m' | 'a' | 'l', string]
const c = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`

const ICONS: Record<string, { theme: IconTheme; parts: Part[] }> = {
  // App und Navigation
  home: { theme: 'app', parts: [['m', 'M4 11 12 4l8 7v9H4z'], ['a', 'M10 20v-5h4v5']] },
  mehr: { theme: 'app', parts: [['m', 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6z'], ['a', 'M13.5 13.5h6v6h-6z']] },
  suche: { theme: 'app', parts: [['m', c(10.5, 10.5, 6)], ['l', 'm15 15 5 5']] },
  sperre: { theme: 'app', parts: [['m', 'M5.5 10.5h13v10h-13zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5'], ['l', 'M12 14.5v2.5']] },
  leser: { theme: 'app', parts: [['m', 'M4 9h8v12H4z'], ['l', 'M15 9.5a3.5 3.5 0 0 1 0 5M17.8 7a7.5 7.5 0 0 1 0 10']] },
  import: { theme: 'app', parts: [['m', 'M4 14v6h16v-6'], ['l', 'M12 4v10M8 10l4 4 4-4']] },
  kalender: { theme: 'app', parts: [['m', 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4'], ['a', 'M8 13h3.5v3.5H8z']] },
  jahr: { theme: 'app', parts: [['m', 'M4 6h16v14H4zM4 10h16M8 3.5v4M16 3.5v4'], ['l', 'M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2']] },
  erfassen: { theme: 'app', parts: [['m', 'M5 19l1-4L16 5l3 3L9 18z'], ['l', 'M13.5 7.5l3 3']] },
  karten: { theme: 'app', parts: [['l', 'M5 7v13h11'], ['m', 'M8 4h11v13H8z']] },
  vergleich: { theme: 'app', parts: [['m', 'M3.5 20h17'], ['a', 'M5.5 20v-6h3v6zM10.5 20V7h3v13zM15.5 20v-9h3v9z']] },
  glocke: { theme: 'app', parts: [['m', 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z'], ['l', 'M10 21h4']] },
  einstellungen: { theme: 'app', parts: [['m', 'M12 3.5l2 1.2 2.3-.3 1.1 2 2 1.1-.3 2.3 1.2 2.2-1.2 2.2.3 2.3-2 1.1-1.1 2-2.3-.3-2 1.2-2-1.2-2.3.3-1.1-2-2-1.1.3-2.3L3.5 12l1.2-2.2-.3-2.3 2-1.1 1.1-2 2.3.3z'], ['a', c(12, 12, 3)]] },
  beleg: { theme: 'app', parts: [['m', 'M7 3h7l4 4v14H7z'], ['l', 'M10 12h5M10 16h5']] },
  geld: { theme: 'app', parts: [['m', c(12, 12, 8)], ['l', 'M14.5 9.3c-.5-.9-1.4-1.3-2.5-1.3-1.4 0-2.5.8-2.5 1.9s1 1.6 2.5 1.9 2.5.9 2.5 2.1-1.1 1.9-2.5 1.9c-1.1 0-2-.4-2.5-1.3M12 6.5V8M12 16v1.5']] },
  // Tiere
  schaf: { theme: 'tiere', parts: [['m', 'M8.5 10c0-2 7-2 7 0v4.5c0 3-1.8 5.5-3.5 5.5s-3.5-2.5-3.5-5.5z'], ['l', 'M6.5 9.5C5 7.5 7 5 9 6c.8-2 5.2-2 6 0 2-1 4 1.5 2.5 3.5M8.5 11.5l-4-1M15.5 11.5l4-1']] },
  kuh: { theme: 'tiere', parts: [['m', 'M8 8.5h8l-.8 7c0 2.3-1.4 4.5-3.2 4.5s-3.2-2.2-3.2-4.5z'], ['l', 'M8 8.5C6 8.5 5 6.5 5 4.5M16 8.5c2 0 3-2 3-4M8.2 10.5l-3.7.8M15.8 10.5l3.7.8'], ['a', 'M9.3 16.5a2.7 1.8 0 0 0 5.4 0 2.7 1.8 0 0 0-5.4 0z']] },
  // zwei Tierköpfe: Gruppe von Tieren
  gruppen: {
    theme: 'tiere',
    parts: [
      ['m', 'M4.3 8.3c0-1.4 5-1.4 5 0v3.3c0 2.2-1.2 3.9-2.5 3.9s-2.5-1.7-2.5-3.9zM4.3 9.3l-2.1-.7M9.3 9.3l2.1-.7'],
      ['a', 'M12 11c0-1.7 6.5-1.7 6.5 0v4.3c0 2.7-1.6 4.7-3.25 4.7S12 18 12 15.3z'],
      ['l', 'M12 12.2l-2.6-.9M18.5 12.2l2.6-.9'],
    ],
  },
  tierinfo: { theme: 'tiere', parts: [['m', 'M4.5 8c0-1.6 6-1.6 6 0v4c0 2.5-1.4 4.5-3 4.5s-3-2-3-4.5zM4.5 9l-2.2-.7M10.5 9l2.2-.7'], ['a', c(16.5, 16, 3)], ['l', 'M18.7 18.2 21 20.5']] },
  tierliste: { theme: 'tiere', parts: [['m', 'M10 7h10M10 12h10M10 17h10'], ['a', `${c(5.5, 7, 1.6)}${c(5.5, 12, 1.6)}${c(5.5, 17, 1.6)}`]] },
  ohrmarke: { theme: 'tiere', parts: [['m', 'M12 3a6 6 0 0 1 6 6v6l-6 6-6-6V9a6 6 0 0 1 6-6z'], ['a', c(12, 8.5, 1.8)], ['l', 'M9.5 14h5']] },
  milch: { theme: 'tiere', parts: [['m', 'M12 3s6 7 6 11.5a6 6 0 0 1-12 0C6 10 12 3 12 3z'], ['l', 'M8.5 15.5c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0']] },
  waage: { theme: 'tiere', parts: [['m', 'M4 20.5h16M12 20.5v-10M5.5 10.5h13'], ['a', 'M12 3.5s2.3 2.6 2.3 4a2.3 2.3 0 0 1-4.6 0c0-1.4 2.3-4 2.3-4zM5.5 10.5l-2 4.5h4zM18.5 10.5l-2 4.5h4z']] },
  merkliste: { theme: 'tiere', parts: [['m', 'M7 4h10v16l-5-3.5L7 20z'], ['l', 'M10 9h4']] },
  tvd: { theme: 'tiere', parts: [['m', 'M4 6h16v12H4z'], ['l', 'M4 7l8 6 8-6']] },
  auslauf: { theme: 'tiere', parts: [['a', c(17.5, 6.5, 2.5)], ['m', 'M4 20v-8M9 20v-8M14 20v-8M2.5 14h13M2.5 18h13']] },
  mast: { theme: 'tiere', parts: [['m', 'M4 4v16h16'], ['l', 'M7 15l4-4 3 3 5-6M15.5 8H19v3.5']] },
  // Fortpflanzung und Jungtiere
  geburt: { theme: 'zucht', parts: [['m', 'M12 3c4 0 7 7 7 11a7 7 0 0 1-14 0c0-4 3-11 7-11z'], ['l', 'm6 12.5 3 2 3-3 3 3 3-2']] },
  belegung: { theme: 'zucht', parts: [['m', 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z'], ['l', 'M9.5 11.5h5M12 9v5']] },
  traechtig: { theme: 'zucht', parts: [['m', c(12, 12, 8)], ['a', c(13, 13, 3.5)]] },
  jungtiere: { theme: 'zucht', parts: [['m', 'M9 9h6v10a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9.5 9V7h5v2'], ['l', 'M11 7V4.5a1 1 0 0 1 2 0V7'], ['a', 'M9 14.5h6V19a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z']] },
  absetzen: { theme: 'zucht', parts: [['m', `${c(7, 17.5, 2.5)}${c(17, 17.5, 2.5)}`], ['l', 'M8.8 15.6 17 4M15.2 15.6 7 4']] },
  selektion: { theme: 'zucht', parts: [['m', 'M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8l-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z'], ['a', c(12, 12, 1.6)]] },
  anpaarung: { theme: 'zucht', parts: [['m', 'M7 3c0 5 10 7 10 18M17 3c0 5-10 7-10 18'], ['l', 'M9 6.5h6M8.5 17.5h7M10.5 12h3']] },
  // Gesundheit
  behandlung: { theme: 'gesundheit', parts: [['m', 'm14.5 4.5 5 5M17 7l-9 9-3.5 1 1-3.5 9-9z'], ['l', 'M4.5 19.5 3 21M10 11l1.5 1.5M12.5 8.5 14 10']] },
  klauen: { theme: 'gesundheit', parts: [['m', 'M7.5 4.5C5 8.5 5 14 7.5 19H11V6zM16.5 4.5C19 8.5 19 14 16.5 19H13V6z'], ['l', 'M4.5 21.5h15']] },
  journal: { theme: 'gesundheit', parts: [['m', 'M5 4h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3z'], ['l', 'M12 8v6M9 11h6']] },
  ausmerzen: { theme: 'gesundheit', parts: [['m', 'M4 7h10M4 12h10M4 17h6'], ['l', 'M15 14l5 5M20 14l-5 5']] },
  // Maschinen und Betrieb
  hof: { theme: 'maschinen', parts: [['m', 'M3 11 12 4l9 7v9H3z'], ['a', 'M9 20v-6h6v6'], ['l', 'M9 14l6 6M15 14l-6 6']] },
  traktor: { theme: 'maschinen', parts: [['m', `M4 13V7h6l2 5h8v4${c(8, 16.5, 3.5)}${c(18, 17.5, 2.5)}`], ['a', 'M6 7v4h4.6L9 7z']] },
  wartung: { theme: 'maschinen', parts: [['m', 'M14.5 4.5a4 4 0 0 0-4.8 5.3L4 15.5 8.5 20l5.7-5.7a4 4 0 0 0 5.3-4.8l-2.6 2.6-2.8-.7-.7-2.8z']] },
  tracking: { theme: 'maschinen', parts: [['m', c(12, 12, 8)], ['l', 'M12 3v3M12 18v3M3 12h3M18 12h3'], ['a', c(12, 12, 2.5)]] },
  plan: { theme: 'maschinen', parts: [['m', 'M6 5h12v16H6z'], ['a', 'M9 3.5h6v3H9z'], ['l', 'M9 11h6M9 15h4']] },
  // Dienste und Personen
  dienste: { theme: 'dienste', parts: [['m', 'M4 6h16v14H4zM8 3.5v4M16 3.5v4'], ['a', c(12, 12.5, 2)], ['l', 'M8.5 18.5c.6-1.8 2-2.8 3.5-2.8s2.9 1 3.5 2.8']] },
  person: { theme: 'dienste', parts: [['a', c(12, 8, 3.5)], ['m', 'M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5']] },
  // Flächen
  karte: { theme: 'flaechen', parts: [['m', 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z'], ['l', 'M9 4v14M15 6v14']] },
  parzelle: { theme: 'flaechen', parts: [['m', 'M5 19C5 10 11 5 19 5c0 8-5 14-14 14z'], ['l', 'M5 19l8-8']] },
  fruchtfolge: { theme: 'flaechen', parts: [['m', 'M19 12a7 7 0 0 1-12.5 4.3M5 12a7 7 0 0 1 12.5-4.3'], ['l', 'M17.5 4v3.7h-3.7M6.5 20v-3.7h3.7']] },
  wiese: { theme: 'flaechen', parts: [['m', 'M5 20c0-6 2-9 4-11M12 20V9M19 20c0-6-2-9-4-11'], ['a', 'M12 9c-1.6-1-1.6-3.2 0-4.8 1.6 1.6 1.6 3.8 0 4.8z']] },
  weide: { theme: 'flaechen', parts: [['m', 'M3 20h18M15 20v-9M20 20v-9M14 13.5h7M14 17h7'], ['l', 'M5 20c0-3 .8-5 2-6.5M8 20c0-2.5-.5-4.5-1.7-6M10.5 20c0-2 .4-3.6 1.3-4.8']] },
  sonne: { theme: 'flaechen', parts: [['a', c(12, 12, 4)], ['l', 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4']] },
  raster: { theme: 'flaechen', parts: [['m', 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16'], ['a', 'M10 10h5v5h-5z']] },
  holz: { theme: 'flaechen', parts: [['m', `${c(7.5, 16.5, 3.5)}${c(16.5, 16.5, 3.5)}${c(12, 9, 3.5)}`], ['a', `${c(7.5, 16.5, 1.2)}${c(16.5, 16.5, 1.2)}${c(12, 9, 1.2)}`]] },
  // Bau
  bau: { theme: 'bau', parts: [['m', 'M4 21h16M6 21V11h7v10'], ['l', 'M15 21V4M10 4h9.5M18 4v3'], ['a', 'M8 13.5h3v3H8z']] },
}

export type IconName = keyof typeof ICONS

export function isIconName(v: string | null | undefined): v is IconName {
  return !!v && v in ICONS
}

export function iconTheme(name: string): IconTheme | null {
  return ICONS[name]?.theme ?? null
}

/** Symbol als Kachel. `muted`: graue Kachel (z.B. nicht gewählter Punkt der Fussleiste). Unbekannte Werte als Text. */
export default function AppIcon({ icon, size = 32, muted = false, className = '', title }: { icon: string; size?: number; muted?: boolean; className?: string; title?: string }): ReactNode {
  const def = ICONS[icon]
  if (!def) {
    return (
      <span aria-hidden className={`inline-grid shrink-0 place-items-center leading-none ${className}`} style={{ width: size, height: size, fontSize: size * 0.75 }}>
        {icon}
      </span>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={`shrink-0 ${className}`}
    >
      {title && <title>{title}</title>}
      <rect width="32" height="32" rx="8" fill={muted ? ICON_MUTED : ICON_THEMES[def.theme]} />
      <g transform="translate(4 4)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {def.parts.map(([kind, d], i) => (
          <path key={i} d={d} fill={kind === 'a' ? 'rgba(255,255,255,0.45)' : 'none'} />
        ))}
      </g>
    </svg>
  )
}

/** Alle Namen (für die Vorschau im Test und in der Verwaltung). */
export const ICON_NAMES = Object.keys(ICONS)
