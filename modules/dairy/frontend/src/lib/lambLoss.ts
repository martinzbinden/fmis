// Ursachen bei toten Jungtieren: eigene Kurzliste, denn es gibt keinen verbindlichen internationalen
// Schlüssel dafür. ICAR verlangt (Guidelines Section 21), Totgeburten und Tod innert 24 h mit Bezug zu den
// Eltern zu erfassen, gibt aber keine Ursachen vor. Einteilung nach dem Zeitpunkt, wie bei Sektionen
// üblich (vor, während, nach der Geburt); `icar` verweist wo möglich auf den ICAR Central Health Key
// (Version 2018, siehe lib/diagnoses.ts). Er ist für Rinder gemacht, darum haben typische Lämmerverluste
// wie Unterkühlung keinen Code. Gespeichert wird der eigene Schlüssel.

export interface LossItem {
  key: string
  label: string
  icar: string | null
}

export const LOSS_GROUPS: { label: string; items: LossItem[] }[] = [
  {
    label: 'Vor der Geburt',
    items: [
      { key: 'abort', label: 'Abort (zu früh, nicht ausgetragen)', icar: '2.02.02.02.' },
      { key: 'mumifiziert', label: 'Mumifiziert', icar: '2.02.02.01.02.' },
      { key: 'faul', label: 'Faul, schon länger tot', icar: '2.02.02.01.03.' },
    ],
  },
  {
    label: 'Während der Geburt',
    items: [
      { key: 'schwergeburt', label: 'Schwergeburt, zu gross', icar: '2.03.01.01.' },
      { key: 'fehllage', label: 'Fehllage', icar: '2.03.05.' },
      { key: 'erstickt', label: 'Erstickt (Eihaut, Fruchtwasser)', icar: '1.06.07.01.' },
      { key: 'totgeburt_unklar', label: 'Ausgetragen, tot geboren, Grund unklar', icar: '2.03.01.02.' },
    ],
  },
  {
    label: 'Nach der Geburt',
    items: [
      { key: 'lebensschwach', label: 'Lebensschwach, nicht getrunken', icar: null },
      { key: 'unterkuehlt', label: 'Unterkühlt oder verhungert', icar: null },
      { key: 'verlassen', label: 'Von der Mutter nicht angenommen', icar: null },
      { key: 'erdrueckt', label: 'Erdrückt oder verletzt', icar: null },
      { key: 'krank', label: 'Krank (Durchfall, Nabel, Lunge)', icar: null },
    ],
  },
  {
    label: 'Übriges',
    items: [
      { key: 'gebrechen', label: 'Gebrechen, Missbildung', icar: '2.03.01.04.' },
      { key: 'unbekannt', label: 'Unbekannt', icar: null },
    ],
  },
]

export const DEFECTS: LossItem[] = [
  { key: 'kiefer', label: 'Kiefer, Maul, Gaumen', icar: '1.07.02.' },
  { key: 'afterlos', label: 'After fehlt', icar: '1.07.02.01.' },
  { key: 'nabelbruch', label: 'Nabelbruch', icar: '1.02.02.01.01.' },
  { key: 'gliedmassen', label: 'Beine, Gelenke, Wirbelsäule', icar: '1.09.02.' },
  { key: 'kopf', label: 'Kopf, Gehirn, Augen', icar: '1.11.02.' },
  { key: 'herz', label: 'Herz', icar: '1.05.02.' },
  { key: 'haut', label: 'Haut, Wolle', icar: '1.01.02.' },
  { key: 'geschlecht', label: 'Geschlechtsorgane', icar: '2.01.02.02.' },
  { key: 'anderes', label: 'Anderes (Bemerkung)', icar: null },
]

const LABEL = new Map([...LOSS_GROUPS.flatMap((g) => g.items), ...DEFECTS].map((i) => [i.key, i.label]))

export function lossLabel(key: string | null | undefined): string | null {
  return key ? (LABEL.get(key) ?? key) : null
}

export const parseDefects = (v: string | null | undefined): string[] => (v ? v.split(',').filter(Boolean) : [])

export function toggleDefect(current: string[], key: string): string {
  return (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]).join(',')
}

/** TSV Art. 129: jeder sichtbare Abort ist zu melden, bei mehr als einem innert 4 Monaten sind Proben nötig. */
export const ABORT_MONTHS = 4
export const isAbort = (key: string | null | undefined): boolean => key === 'abort'
