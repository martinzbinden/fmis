import type { ReactNode } from 'react'
import Modal from '@fmis/core/Modal'
import BoardCardView from './BoardCardView'
import LactationSpark from './LactationSpark'
import NursingLambs, { WeanedLambs } from './NursingLambs'
import type { BoardCard } from '../lib/board'
import type { CardFieldKey } from '../lib/cardFields'
import type { MeatValue } from '../lib/meatValue'
import type { LactationLevel } from '../lib/lactationTrend'

// Legende der Dashboard-Karten (Knopf ⓘ): eine Musterkarte mit erfundenen Werten, gerendert mit derselben Karte wie
// im Dashboard, darunter jedes Element mit einem Beispiel und seiner Bedeutung.

const LEVELS: LactationLevel[] = [
  { lactation_number: 1, level: 1.08, running: false, tests: 8 },
  { lactation_number: 2, level: 0.96, running: false, tests: 8 },
  { lactation_number: 3, level: 0.62, running: false, tests: 7 },
  { lactation_number: 4, level: 0.9, running: true, tests: 4 },
]

const SAMPLE: BoardCard = {
  id: 'muster',
  laufNr: '123',
  earTag: 'CH113999990017',
  shortTag: '9999.9001',
  name: null,
  sex: 'w',
  birthDate: '2021-03-20',
  ageMonths: 68,
  groupId: null,
  listIds: [],
  dry: false,
  nursing: 1,
  pregnancy: null,
  expectedBirth: null,
  lastBirth: '2026-10-21',
  daysSinceBirth: 24,
  parity: 4,
  lactationNumber: 4,
  litterMean: 2.3,
  lastLitterSize: 3,
  litterAlive: 3,
  litterDead: 0,
  ltlMilk: 0.84,
  performanceRel: 1.05,
  idxPerformance: 108,
  scc12m: 245,
  idxScc: 96,
  sccRelPeers: 128,
  levels: LEVELS,
  intervalDays: 362,
  lambMilk: { lambs: 2, missing: 1, totalKg: 52, perDay: 1.9 },
  breedingValue: 112,
  reasons: [{ area: 'euter', weight: 2, text: 'Zellzahl hoch' }],
  reasonScore: 2,
  healthDays12m: 0,
}

const SAMPLE_MEAT: MeatValue = { kind: 'Schaf', ageDays: 2087, kg: 27, pricePerKg: 6.3, gross: 170.1, net: 158.9 }
const ALL_FIELDS: CardFieldKey[] = ['weaned', 'lambMilk', 'milk', 'scc', 'spark', 'ltl', 'zw', 'litter', 'interval', 'meat']

function Item({ sample, title, children }: { sample: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-gray-100 py-2.5">
      <div className="flex w-28 shrink-0 items-start justify-center pt-0.5">{sample}</div>
      <div className="min-w-0 text-sm text-gray-800">
        <div className="font-semibold text-gray-900">{title}</div>
        <div className="text-gray-700">{children}</div>
      </div>
    </li>
  )
}

const chip = (cls: string, text: string) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>

export default function CardLegend({ species, onClose }: { species: 'sheep' | 'cattle'; onClose: () => void }) {
  const sheep = species === 'sheep'
  const young = sheep ? 'Lämmer' : 'Kälber'
  return (
    <Modal title="Legende der Karten" onClose={onClose} dirty={false}>
      <p className="mb-2 text-sm text-gray-700">Musterkarte mit erfundenen Werten. Welche Zeilen auf den Karten stehen, wählst du im Menü «Karte».</p>
      <div className="pointer-events-none mb-3 rounded-xl bg-gray-100 p-2" aria-label="Musterkarte">
        <BoardCardView
          card={SAMPLE}
          moduleKey={sheep ? 'dairy_schafe' : 'dairy'}
          today="2026-11-14"
          colors={[]}
          filterNames={[]}
          selected={false}
          expanded={false}
          pendingTo={null}
          canDrag={false}
          onSelect={() => undefined}
          onToggle={() => undefined}
          onDragCard={() => undefined}
          onDragHandle={() => undefined}
          meat={sheep ? SAMPLE_MEAT : null}
          fields={ALL_FIELDS.filter((k) => sheep || (k !== 'meat' && k !== 'litter' && k !== 'lambMilk'))}
        />
      </div>

      <ul>
        <Item title="Kopf der Karte" sample={<span className="text-lg font-bold">123</span>}>
          Laufnummer, kurze Ohrmarke, Geschlecht, Alter. Das Kästchen wählt die Karte aus (mehrere gleichzeitig), am Griff ⠿ ziehen verschiebt sie in eine andere Spalte. Antippen klappt alle Angaben auf.
        </Item>
        <Item title="Trächtigkeit, trocken" sample={<span className="flex flex-wrap gap-1">{chip('bg-sky-100 text-sky-900', 'trächtig')}{chip('bg-orange-100 text-orange-900', 'leer')}</span>}>
          Ergebnis der letzten Untersuchung seit der letzten Geburt. «trocken» heisst nicht in Milch.
        </Item>
        <Item title="Ausmerzgründe" sample={chip('bg-red-100 text-red-900', '⚠ 1')}>
          Anzahl Gründe der Ausmerzliste (z.B. Zellzahl, Fruchtbarkeit). Aufgeklappt stehen sie im Klartext.
        </Item>
        <Item title={`Saugende ${young}`} sample={<NursingLambs count={2} young={young} />}>
          Grün gefüllte Tiere: so viele {young} laufen jetzt mit der Mutter mit und saugen (unter 120 Tagen, nicht abgesetzt).
        </Item>
        <Item title={`Abgesetzte ${young}`} sample={<WeanedLambs count={2} alive={3} dead={0} young={young} />}>
          Blaue Umriss-Tiere mit Haken: «2/3» = von 3 lebend geborenen {young} des letzten Wurfs wurden 2 erfolgreich abgesetzt. Verkaufte oder geschlachtete zählen mit, verendete nicht.
        </Item>
        {sheep && (
          <Item title="Fleischwert" sample={chip('bg-stone-200 text-stone-900', '≈ 159 Fr.')}>
            Geschätzter Schlachterlös nach Alter am Schlachttermin und Proviande-Preis, nach Abzügen. Gewichte und Preise stellst du unter «🥩 Fleischwert» ein. Das grüne Feld oben in der Spalte ist die Summe aller Karten.
          </Item>
        )}
        <Item title="Milch" sample={<span className="text-[11px] text-gray-700">Herde 108 · Gleichalt. 105 %</span>}>
          <b>Herde</b>: Leistungsindex im Vergleich mit der ganzen Herde. 100 ist der Durchschnitt, 10 Punkte sind eine Streuung. Höher ist besser.<br />
          <b>Gleichalt.</b>: Leistung in Prozent der gleichaltrigen Tiere. 100 % ist gleich, mehr ist besser.
        </Item>
        <Item title="Zellzahl" sample={<span className="text-[11px] text-gray-700">Herde 96 · Gleichalt. 128 % · Ø 245</span>}>
          <b>Herde</b>: Zellzahl-Index. 100 ist der Durchschnitt, <i>höher ist besser</i> (tiefe Zellzahl gibt einen hohen Index).<br />
          <b>Gleichalt.</b>: Zellzahl in Prozent der Gleichaltrigen (Ø 12 Monate). 100 % ist gleich, <i>tiefer ist besser</i>, 128 % sind 28 % mehr Zellen als die Gleichaltrigen.<br />
          <b>Ø</b>: Zellzahl im Mittel der letzten 12 Monate, in 1000 Zellen/ml.
        </Item>
        <Item title="Laktationen (Minigrafik)" sample={<LactationSpark levels={LEVELS} />}>
          Ein Balken je Laktation, die Zahl darunter ist die Laktationsnummer. Die Höhe zeigt das Leistungsniveau gegenüber der Herde, die gestrichelte Linie ist das Herdenmittel (100 %).<br />
          <span className="font-semibold text-gray-900">Dunkel</span>: abgeschlossene Laktation ab 80 % der Herde. <span className="font-semibold text-red-700">Rot</span>: unter 80 % der Herde (hier die 3.). <span className="font-semibold text-gray-600">Hell mit gestricheltem Rand</span>: laufende Laktation, noch nicht abgeschlossen.
        </Item>
        {sheep && (
          <Item title="Milch der Lämmer" sample={<span className="text-[11px] text-gray-700">≈ 1.9 kg/Tag · 52 kg</span>}>
            Geschätzte Milch, die die Lämmer des letzten Wurfs bei der Mutter getrunken haben: Zuwachs zwischen der ersten Wägung (Geburt oder Ohrmarke) und dem Absetzen oder Wegnehmen, mal Milchfaktor (Vorgabe 5 kg Milch je kg Zuwachs). Es zählt nur bis zum Alter von 35 Tagen und bis zur Umstellung auf Eimer. «1 ohne Wägung» heisst, bei einem Lamm fehlt eine Wägung. Eine Näherung, keine Messung.
          </Item>
        )}
        <Item title="Lebenstagleistung" sample={<span className="text-[11px] text-gray-700">0.84 kg</span>}>
          Milch je Lebenstag in kg.
        </Item>
        <Item title={sheep ? 'Zuchtwert (GZW)' : 'Zuchtwert (ISET)'} sample={<span className="text-[11px] text-gray-700">112</span>}>
          Gesamtzuchtwert aus dem Herdebuch, höher ist besser.
        </Item>
        {sheep && (
          <Item title="Wurf" sample={<span className="text-[11px] text-gray-700">letzter 3 · Ø 2.3</span>}>
            Grösse des letzten Wurfs (inklusive tot Geborene) und Mittel aller Würfe.
          </Item>
        )}
        <Item title={sheep ? 'Zwischenablammzeit' : 'Zwischenkalbezeit'} sample={<span className="text-[11px] text-gray-700">Ø 362 Tage</span>}>
          Mittlere Tage zwischen zwei Geburten, ab zwei Geburten.
        </Item>
        <Item title="Farbiger Rand" sample={<span className="h-6 w-14 rounded-md border-2 border-orange-400 bg-orange-50" />}>
          Karten sind in der Farbe der eingefärbten Filter umrandet (z.B. «Leer» orange). Mehrere Filter geben mehrere Streifen unter dem Kopf.
        </Item>
      </ul>
    </Modal>
  )
}
