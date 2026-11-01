// Kurzliste der Diagnosen für Behandlung und Krankheit (schema/0022): eigene
// deutsche Bezeichnungen, je mit Verweis auf den ICAR Central Health Key
// (Version 2018, https://www.icar.org/icar-central-health-key/), angelehnt an
// dessen «Reduced key II (manual)» für die Erfassung durch Landwirte. Der ICAR-
// Schlüssel ist für Rinder gemacht; Schaf-Krankheiten ohne passenden Code (z.B.
// Moderhinke) haben icar = null. Gespeichert wird der eigene Schlüssel `key` —
// er bleibt, auch wenn sich die Zuordnung zu ICAR ändert. Der Text im Feld
// «Befund» bleibt frei für Einzelheiten.

import type { Species } from './fertility'

export interface Diagnosis {
  key: string
  label: string
  /** Code im ICAR Central Health Key; null = dort nicht vorhanden */
  icar: string | null
  /** nur für diese Tierart (sonst beide) */
  only?: Species
  /** Erklärung für die Auswahl (was gemeint ist) */
  hint?: string
}

export interface DiagnosisGroup {
  label: string
  items: Diagnosis[]
}

export const DIAGNOSIS_GROUPS: DiagnosisGroup[] = [
  {
    label: 'Euter',
    items: [
      { key: 'mastitis_subklinisch', label: 'Mastitis ohne Symptome (hohe Zellzahl)', icar: '1.13.01.10.', hint: 'Schalmtest positiv, Milch sieht normal aus' },
      { key: 'mastitis_akut', label: 'Mastitis akut', icar: '1.13.01.02.', hint: 'Flocken, Viertel warm oder geschwollen, Tier sonst munter' },
      { key: 'mastitis_schwer', label: 'Mastitis schwer (Tier krank)', icar: '1.13.01.09.', hint: 'Fieber, frisst nicht, Viertel hart' },
      { key: 'mastitis_chronisch', label: 'Mastitis chronisch / wiederkehrend', icar: '1.13.01.03.' },
      { key: 'euter_abszess', label: 'Euterabszess', icar: '1.13.01.06.' },
      { key: 'euter_verletzung', label: 'Verletzung an Euter oder Zitze', icar: '1.12.06.' },
      { key: 'milchfluss', label: 'Milchfluss gestört (Zitze verengt)', icar: '1.12.08.' },
      { key: 'euter_andere', label: 'Andere Euterkrankheit', icar: '1.12.99.' },
    ],
  },
  {
    label: 'Klauen und Bewegung',
    items: [
      { key: 'moderhinke', label: 'Moderhinke', icar: null, only: 'sheep', hint: 'übel riechend, Horn löst sich ab (Dichelobacter)' },
      { key: 'zwischenzehen', label: 'Zwischenzehenentzündung / Klauenfäule', icar: '1.10.07.11.', hint: 'Haut zwischen den Klauen gerötet, nässend' },
      { key: 'mortellaro', label: 'Mortellaro (Dermatitis digitalis)', icar: '1.10.07.10', only: 'cattle' },
      { key: 'sohlengeschwuer', label: 'Sohlengeschwür', icar: '1.10.07.03.', only: 'cattle' },
      { key: 'weisse_linie', label: 'Weisse-Linie-Defekt / Abszess', icar: '1.10.12.01.' },
      { key: 'klauenrehe', label: 'Klauenrehe', icar: '1.10.06.09.' },
      { key: 'ballenfaeule', label: 'Ballenhornfäule', icar: '1.10.07.09.', only: 'cattle' },
      { key: 'limax', label: 'Limax (Zwischenklauenwulst)', icar: '1.10.06.10.', only: 'cattle' },
      { key: 'phlegmone', label: 'Panaritium / Phlegmone (Schwellung Kronsaum)', icar: '1.10.07.08.' },
      { key: 'gelenk_verletzung', label: 'Verletzung an Bein oder Gelenk', icar: '1.09.04.' },
      { key: 'lahm_unklar', label: 'Lahm, Ursache unklar', icar: '1.09.05.' },
    ],
  },
  {
    label: 'Fruchtbarkeit und Geburt',
    items: [
      { key: 'schwergeburt', label: 'Schwergeburt', icar: '2.03.01.01.' },
      { key: 'totgeburt', label: 'Totgeburt', icar: '2.03.01.02.' },
      { key: 'abort', label: 'Abort (Verwerfen)', icar: '2.02.02.02.' },
      { key: 'nachgeburt', label: 'Nachgeburtsverhalten', icar: '2.04.03.' },
      { key: 'gebaermuttervorfall', label: 'Gebärmuttervorfall', icar: '2.04.02.' },
      { key: 'scheidenvorfall', label: 'Scheidenvorfall', icar: '2.01.06.02.' },
      { key: 'gebaermutterentzuendung', label: 'Gebärmutterentzündung', icar: '2.05.01.01.' },
      { key: 'scheidenentzuendung', label: 'Scheidenentzündung', icar: '2.01.06.03.' },
      { key: 'brunstlos', label: 'Keine Brunst (stille Brunst)', icar: '2.05.02.01.02.' },
      { key: 'zysten', label: 'Eierstockzysten', icar: '2.05.02.04.', only: 'cattle' },
      { key: 'fruchtbarkeit_andere', label: 'Andere Fruchtbarkeitsstörung', icar: '2.99.' },
    ],
  },
  {
    label: 'Stoffwechsel',
    items: [
      { key: 'milchfieber', label: 'Milchfieber (Festliegen nach der Geburt)', icar: '6.03.01.01.' },
      { key: 'ketose', label: 'Ketose', icar: '6.01.02.', hint: 'beim Schaf auch Trächtigkeitstoxikose' },
      { key: 'pansenazidose', label: 'Pansenübersäuerung', icar: '1.07.10.06.' },
      { key: 'blaehung', label: 'Blähung (Pansentympanie)', icar: '1.07.10.07.' },
      { key: 'labmagen', label: 'Labmagenverlagerung', icar: '1.07.12.05.', only: 'cattle' },
      { key: 'weidetetanie', label: 'Weidetetanie (Magnesiummangel)', icar: '6.03.02.01.' },
      { key: 'abmagerung', label: 'Starke Abmagerung', icar: '6.01.05.' },
      { key: 'stoffwechsel_andere', label: 'Anderer Stoffwechsel- oder Mangelzustand', icar: '6.99.' },
    ],
  },
  {
    label: 'Allgemein, Atmung, Verdauung',
    items: [
      { key: 'fieber', label: 'Fieber', icar: '8.11.' },
      { key: 'durchfall', label: 'Durchfall', icar: '8.13.' },
      { key: 'verdauung', label: 'Frisst nicht / Verdauungsstörung', icar: '8.10.' },
      { key: 'lunge', label: 'Lungenentzündung', icar: '1.06.07.06.' },
      { key: 'atemwege', label: 'Husten / Atemwegserkrankung', icar: '1.06.' },
      { key: 'festliegen', label: 'Festliegen (andere Ursache)', icar: '8.12.' },
      { key: 'wunde', label: 'Wunde / Hautverletzung', icar: '1.01.04.' },
      { key: 'haut', label: 'Hautkrankheit', icar: '1.01.' },
      { key: 'auge', label: 'Augenentzündung', icar: '1.11.07.01.', hint: 'beim Schaf auch Gämsblindheit' },
      { key: 'nerven', label: 'Nervensystem (Kreisen, Lähmung)', icar: '1.11.' },
      { key: 'vergiftung', label: 'Vergiftung', icar: '7.' },
    ],
  },
  {
    label: 'Parasiten',
    items: [
      { key: 'magen_darm_wuermer', label: 'Magen-Darm-Würmer', icar: '5.02.07.' },
      { key: 'haemonchus', label: 'Roter Magenwurm (Haemonchus)', icar: '5.02.07.02.', only: 'sheep' },
      { key: 'leberegel', label: 'Leberegel', icar: '5.02.01.' },
      { key: 'bandwurm', label: 'Bandwurm', icar: '5.02.03.' },
      { key: 'lungenwurm', label: 'Lungenwürmer', icar: '5.02.05.' },
      { key: 'kokzidiose', label: 'Kokzidiose', icar: '5.01.02.' },
      { key: 'raeude', label: 'Räude', icar: '5.03.04.' },
      { key: 'laeuse', label: 'Läuse / Haarlinge', icar: '5.03.05.' },
      { key: 'parasiten_andere', label: 'Andere Parasiten', icar: '5.99.' },
    ],
  },
  {
    label: 'Infektionskrankheiten',
    items: [
      { key: 'enterotoxaemie', label: 'Enterotoxämie (Breinierenkrankheit)', icar: '4.03.13.06.' },
      { key: 'blauzunge', label: 'Blauzungenkrankheit', icar: '4.02.18.' },
      { key: 'schmallenberg', label: 'Schmallenberg-Virus', icar: '4.02.20.' },
      { key: 'listeriose', label: 'Listeriose', icar: '4.03.21.' },
      { key: 'paratuberkulose', label: 'Paratuberkulose', icar: '4.03.04.' },
      { key: 'pseudotuberkulose', label: 'Pseudotuberkulose (Abszesse an Lymphknoten)', icar: '1.04.05.', only: 'sheep' },
      { key: 'lippengrind', label: 'Lippengrind (Ecthyma)', icar: null, only: 'sheep' },
      { key: 'maedi_visna', label: 'Maedi-Visna', icar: null, only: 'sheep' },
      { key: 'infektion_andere', label: 'Andere Infektionskrankheit', icar: '4.99.' },
    ],
  },
  {
    label: 'Jungtiere',
    items: [
      { key: 'jung_durchfall', label: 'Durchfall beim Jungtier', icar: '1.07.13.01.05.' },
      { key: 'nabel', label: 'Nabelentzündung', icar: '1.02.05.' },
      { key: 'lebensschwach', label: 'Lebensschwach nach der Geburt', icar: '1.06.07.01.' },
      { key: 'kuemmern', label: 'Kümmert / wächst schlecht', icar: '8.09.' },
      { key: 'nabelbruch', label: 'Nabelbruch', icar: '1.02.02.01.01.' },
    ],
  },
  {
    label: 'Andere',
    items: [{ key: 'andere', label: 'Andere (nicht in der Liste)', icar: '9.02.' }],
  },
]

const ALL = DIAGNOSIS_GROUPS.flatMap((g) => g.items)
const BY_KEY = new Map(ALL.map((d) => [d.key, d]))

export const diagnosisByKey = (key: string | null | undefined): Diagnosis | undefined => (key ? BY_KEY.get(key) : undefined)

/** Gruppen für eine Tierart (Einträge nur der anderen Art weggelassen). */
export function groupsFor(species: Species): DiagnosisGroup[] {
  return DIAGNOSIS_GROUPS.map((g) => ({ ...g, items: g.items.filter((d) => !d.only || d.only === species) })).filter((g) => g.items.length > 0)
}
