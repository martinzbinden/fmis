import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useStallMode } from '@fmis/core/stallMode'
import { Link } from 'react-router-dom'
import { colorOf } from '@fmis/core/filters/filterModel'
import { areaLabel, breedingBadge, choiceValue, SEX_LABEL, weanedOfLastLitter, type BoardCard } from '../lib/board'
import { fmtAge, fmtDate } from '../lib/format'
import { RESULT_LABEL, METHOD_LABEL } from '../lib/pregnancy'
import { speciesTerms } from '../lib/species'
import { meatBarColor, meatBarMax, meatBarPercent, MEAT_BAND_LABEL, type MeatLimit, type MeatValue } from '../lib/meatValue'
import type { CardFieldKey } from '../lib/cardFields'
import { preselectionLabel, type Preselection } from '../lib/lambRecommendation'
import LactationSpark from './LactationSpark'
import SearchPick from '@fmis/core/SearchPick'
import { fmtCells } from '../lib/culling'
import { MilkFeedChip } from './MilkFeedChip'
import type { MilkFeed, MilkFeedSettings, MilkSample } from '../lib/milkFeed'
import NursingLambs, { WeanedLambs } from './NursingLambs'
import { VERDICT_LABEL, type Verdict, type VerdictResult } from '../lib/cardVerdict'

const CHOICE_TONE: Record<string, string> = {
  zucht: 'bg-green-700 text-white',
  eher_ja: 'bg-green-100 text-green-950',
  spaeter: 'bg-gray-200 text-gray-900',
  eher_nein: 'bg-amber-100 text-amber-950',
  mast: 'bg-amber-700 text-white',
  offen: 'text-gray-600',
}

/** Ampel-Kante links und Empfehlung (lib/cardVerdict.ts) */
const VERDICT_EDGE: Record<Verdict, string> = {
  ausmerzen: 'border-l-red-600',
  beobachten: 'border-l-amber-500',
  behalten: 'border-l-emerald-600',
  jung: 'border-l-gray-300',
}
const VERDICT_PILL: Record<Verdict, string> = {
  ausmerzen: 'bg-red-100 text-red-900',
  beobachten: 'bg-amber-100 text-amber-900',
  behalten: 'bg-emerald-100 text-emerald-900',
  jung: 'bg-gray-100 text-gray-700',
}

const SEX_ICON: Record<string, string> = { w: '♀', m: '♂', k: '⚲' }

const n1 = (v: number | null, d = 1) => (v == null ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }))
const n0 = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('de-CH'))

/** Die Karte eines Tiers: Nummern, Geschlecht und Geburtsdatum immer; aufgeklappt Trächtigkeit, Geburt,
 * Leistung und Ausmerzgründe. Farben stammen von den eingefärbten Filtern. */
/** Zucht-Mehrwert eines Jungtiers für die Karte (lib/lambValue.ts) */
export interface CardLambValue {
  francs: number
  pct: number
  tip: string
}

export default function BoardCardView({
  card,
  moduleKey,
  today,
  colors,
  filterNames,
  selected,
  expanded,
  pendingTo,
  canDrag,
  onSelect,
  onToggle,
  onUndoDraft,
  onRemoveFromList,
  groupChoices,
  onMoveToGroup,
  meat,
  milkFeed,
  lastMilk = null,
  lambValue = null,
  milkFeedSettings,
  meatLimits,
  fields = [],
  verdict = null,
  money = null,
  onChoice,
  onDragCard,
  onDragHandle,
}: {
  card: BoardCard
  moduleKey: string
  today: string
  /** Farbschlüssel der passenden Filter im Modus «einfärben» */
  colors: string[]
  filterNames: string[]
  selected: boolean
  expanded: boolean
  /** Entwurf: Name der Zielgruppe */
  pendingTo: string | null
  canDrag: boolean
  onSelect: () => void
  onToggle: () => void
  onUndoDraft?: () => void
  /** in einer Merklisten-Spalte: von dieser Liste nehmen (kleiner Knopf vor dem Griff) */
  onRemoveFromList?: () => void
  /** in einer Gruppen-Spalte: Zielgruppen für den kleinen Wechsel-Knopf vor dem Griff (null = ohne Gruppe) */
  groupChoices?: { id: string | null; name: string }[]
  onMoveToGroup?: (groupId: string | null) => void
  /** geschätzter Fleischwert (nur Schafe, wenn aktiv) */
  meat?: MeatValue | null
  /** Milch gegen Futter bis zur nächsten Geburt (Kartenfeld «milkFeed») */
  milkFeed?: MilkFeed | null
  /** zuletzt gewogene Milch (Milchwägung oder Milchprüfung), Kartenfeld «Letzte Wägung» */
  lastMilk?: MilkSample | null
  /** Zucht-Mehrwert aus der Abstammung (lib/lambValue.ts), Kartenfeld «lambValue» */
  lambValue?: CardLambValue | null
  milkFeedSettings?: MilkFeedSettings
  /** auf der Karte gewählte Eigenschaften (Menü «Karte») */
  /** Grenzen im Fleischwert-Balken (schwere Aue, schweres Lamm T3/H3/C3); die Skala ist fest */
  meatLimits?: MeatLimit[]
  fields?: CardFieldKey[]
  /** Empfehlung (Ampel-Kante); null = keine */
  verdict?: VerdictResult | null
  /** Geldbilanz zum Aufklappen: Schlachtwert jetzt gegen Milch − Futter bis zur Geburt */
  money?: { slaughter: number; keep: number; diff: number } | null
  /** Kartenfeld «Zuchtauswahl» antippen: Dialog mit Empfehlung und Skala (components/ChoiceDialog.tsx) */
  onChoice?: () => void
  onDragCard: (e: ReactPointerEvent) => void
  onDragHandle: (e: ReactPointerEvent) => void
}) {
  const terms = speciesTerms(moduleKey)
  const main = colors[0] ? colorOf(colors[0]) : null
  const age = card.birthDate ? fmtAge(card.birthDate, today) : null
  const badge = breedingBadge(card, today)
  const choice = choiceValue(card)
  const [picking, setPicking] = useState(false)
  // Stallmodus: grössere Karte, ganze Kopfzeile mindestens 48 px hoch
  const stall = useStallMode()

  return (
    <div
      data-card={card.id}
      onPointerDown={onDragCard}
      title={filterNames.length ? filterNames.join(', ') : undefined}
      className={`rounded-lg border-2 shadow-sm transition-colors ${stall ? 'p-2 text-base' : 'p-1.5 sm:p-2'} ${pendingTo ? 'border-dashed border-amber-500 bg-amber-50' : selected ? 'border-brand-700 bg-brand-50 shadow-md' : main ? main.card : 'border-gray-200 bg-white'} ${selected && pendingTo ? 'ring-2 ring-brand-700' : ''} ${verdict && !pendingTo ? `border-l-[6px] ${VERDICT_EDGE[verdict.verdict]}` : ''} ${canDrag ? 'cursor-grab' : ''}`}
    >
      <div className="flex items-start gap-1">
        {/* Auswahl: runder Haken, gewählt gefüllt; die ganze Karte wird dann eingefärbt */}
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          data-no-drag
          onClick={onSelect}
          aria-label={`Tier ${card.laufNr ?? card.shortTag} auswählen`}
          title={selected ? 'Aus der Auswahl nehmen' : 'Auswählen (mehrere Tiere gemeinsam verschieben oder auf eine Merkliste)'}
          className="-m-1 grid h-11 w-9 shrink-0 place-items-center"
        >
          <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-full border-2 text-sm font-bold leading-none ${selected ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-400 bg-white text-transparent hover:border-brand-600 hover:text-brand-300'}`}>
            ✓
          </span>
        </button>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className={`min-w-0 flex-1 text-left ${stall ? 'min-h-12' : ''}`}>
          {/* Ohrmarke immer ganz: lieber Geschlecht/Alter auf die nächste Zeile umbrechen als die Nummer abschneiden */}
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="shrink-0 text-lg font-bold leading-tight text-gray-900">{card.laufNr ?? '–'}</span>
            <span className={`shrink-0 whitespace-nowrap tabular-nums text-gray-600 ${stall ? 'text-sm' : 'text-xs'}`}>{card.shortTag}</span>
            {card.sex && <span className="text-sm text-gray-700" title={SEX_LABEL[card.sex]}>{SEX_ICON[card.sex]}</span>}
            {/* am Handy: Alter gleich in der ersten Zeile, die Zeile mit Geschlecht und Geburtsdatum entfällt */}
            {age && <span className="shrink-0 text-xs text-gray-600 sm:hidden">{age}</span>}
          </span>
          <span className="hidden text-xs text-gray-600 sm:block">
            {card.sex ? `${SEX_LABEL[card.sex]} · ` : ''}
            {card.birthDate ? `geb. ${fmtDate(card.birthDate)}${age ? ` (${age})` : ''}` : 'Geburtsdatum unbekannt'}
          </span>
          <span className={`mt-0.5 flex flex-wrap gap-1 font-medium sm:mt-1 ${stall ? 'text-sm' : 'text-[0.73rem]'}`}>
            {verdict && verdict.verdict !== 'jung' && (
              <span
                className={`rounded px-1.5 py-0.5 ${VERDICT_PILL[verdict.verdict]}`}
                title={`${verdict.points} Punkte${verdict.parts.length ? `: ${verdict.parts.map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}`).join(', ')}` : ''} (wie Vorschlag «Schlachten»; rot ab 5, gelb ab 2)`}
              >
                {VERDICT_LABEL[verdict.verdict]}
              </span>
            )}
            {badge?.kind === 'belegt' && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-900" title={badge.title} aria-label={`belegt vor ${badge.days} Tagen`}>
                <span aria-hidden className="text-rose-600">♥</span> {badge.days}
              </span>
            )}
            {badge?.kind === 'traechtig' && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-900" title={badge.title} aria-label={`trächtig${badge.days != null ? `, belegt vor ${badge.days} Tagen` : ''}`}>
                <span aria-hidden>🤰</span> {badge.days ?? 'trächtig'}
              </span>
            )}
            {badge?.kind === 'leer' && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-900" title={badge.title}>
                leer
              </span>
            )}
            {badge?.kind === 'unsicher' && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-800" title={badge.title} aria-label={`Trächtigkeit unsicher${badge.days != null ? `, belegt vor ${badge.days} Tagen` : ''}`}>
                <span aria-hidden className="text-rose-600">♥</span>? {badge.days ?? ''}
              </span>
            )}
            {card.dry && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-800">trocken</span>}
            <NursingLambs count={card.nursing} young={terms.singular === 'Aue' ? 'Lämmer' : 'Kälber'} />
            {(card.bucketLambs ?? 0) > 0 && (
              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-900" title={`${card.bucketLambs} ${terms.singular === 'Aue' ? 'Lamm/Lämmer' : 'Kalb/Kälber'} am Eimer: bei der Mutter, saugt aber nicht`}>
                🪣 {card.bucketLambs}
              </span>
            )}
            {fields.includes('weaned') && card.litterAlive != null && (
              <WeanedLambs count={weanedOfLastLitter(card)} alive={card.litterAlive} dead={card.litterDead ?? 0} young={terms.singular === 'Aue' ? 'Lämmer' : 'Kälber'} />
            )}
            {card.reasons.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-900">⚠ {card.reasons.length}</span>}
            {pendingTo && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-950">→ {pendingTo} (Entwurf)</span>}
            {meat && !fields.includes('meat') && (
              <span className={`rounded px-1.5 py-0.5 ${meat.kind === 'Lamm' || meat.kind === 'Kalb' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-900'}`} title={`${meat.kind}, ${meat.ageDays} Tage am Schlachttermin, ca. ${meat.kg} kg SG, ${meat.pricePerKg.toFixed(2)} Fr./kg, nach Abzügen`}>
                ≈ {Math.round(meat.net)} Fr. · {meat.kind}
              </span>
            )}
            {meat?.boundary && !fields.includes('meat') && (
              <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-950" title={`Preisgrenze: ${meat.boundary.text}`}>
                ⏳ {meat.boundary.days} T. −{Math.round(meat.boundary.loss)} Fr.
              </span>
            )}
          </span>
        </button>
        {/* rechts übereinander: Griff (ziehen), darunter ⇄ Gruppe wechseln bzw. ✕ von der Liste — so bleibt der Name breit */}
        <span className="-mr-1 flex shrink-0 flex-col items-center">
          {/* Griff ganz rechts: dort sucht man ihn zum Ziehen */}
          {canDrag && (
            <span
              onPointerDown={onDragHandle}
              style={{ touchAction: 'none' }}
              className="grid h-10 w-8 shrink-0 cursor-grab place-items-center rounded text-xl text-gray-400 hover:text-gray-600 active:bg-gray-100"
              role="img"
              aria-label="Zum Verschieben ziehen"
              title="Ziehen, um zu verschieben"
            >
              ⠿
            </span>
          )}
          {onMoveToGroup && groupChoices && (
            <button
              type="button"
              data-no-drag
              onClick={() => setPicking((v) => !v)}
              aria-expanded={picking}
              aria-label="Gruppe wechseln"
              title="Gruppe wechseln"
              className={`grid h-10 w-8 shrink-0 place-items-center rounded text-base active:bg-gray-100 ${picking ? 'bg-sky-100 text-sky-900' : 'text-gray-500'}`}
            >
              ⇄
            </button>
          )}
          {onRemoveFromList && (
            <button type="button" data-no-drag onClick={onRemoveFromList} aria-label="Von der Liste nehmen" title="Von der Liste nehmen" className="grid h-10 w-8 shrink-0 place-items-center rounded text-base text-gray-500 active:bg-red-50 active:text-red-700">
              ✕
            </button>
          )}
        </span>
      </div>

      {/* Werte über die ganze Kartenbreite (nicht nur neben Griff und ⇄) */}
      {fields.length > 0 && (
        <button type="button" onClick={onToggle} tabIndex={-1} className="block w-full text-left">
          <CardProps card={card} fields={fields} meat={meat ?? null} meatLimits={meatLimits} milkFeed={milkFeed ?? null} lastMilk={lastMilk} lambValue={lambValue} milkFeedSettings={milkFeedSettings} />
        </button>
      )}
      {fields.includes('choice') && choice && (
        // eigener Knopf (nicht im Knopf der Werte): öffnet die Skala
        <button type="button" onClick={onChoice} disabled={!onChoice} className="mt-0.5 flex min-h-7 w-full items-center justify-between gap-2 text-left text-[0.73rem]" title="Zuchtauswahl ändern">
          <span className="text-gray-500">Zuchtauswahl</span>
          <span className={`rounded px-1.5 font-medium ${CHOICE_TONE[choice] ?? ''}`}>
            {preselectionLabel(choice as Preselection) ?? 'offen'}
            {onChoice && <span className="ml-1 opacity-70">✎</span>}
          </span>
        </button>
      )}

      {picking && onMoveToGroup && groupChoices && (
        <div className="mt-1 flex items-center gap-1" data-no-drag>
          <SearchPick
            className="min-w-0 flex-1"
            startOpen
            label="In Gruppe verschieben (Entwurf)"
            placeholder="Gruppe wählen…"
            items={groupChoices.map((g) => ({ id: g.id ?? 'none', label: g.name }))}
            value=""
            onChange={(id) => {
              setPicking(false)
              onMoveToGroup(id === 'none' ? null : id)
            }}
          />
          <button type="button" onClick={() => setPicking(false)} aria-label="Abbrechen" className="grid h-9 w-9 place-items-center rounded text-gray-600 active:bg-gray-100">
            ✕
          </button>
        </div>
      )}

      {colors.length > 1 && (
        <div className="mt-1 flex gap-1" aria-hidden>
          {colors.map((c) => (
            <span key={c} className={`h-1.5 flex-1 rounded-full ${colorOf(c).dot}`} />
          ))}
        </div>
      )}

      {onUndoDraft && (
        <div className="mt-1 flex gap-2 text-xs" data-no-drag>
          <button type="button" onClick={onUndoDraft} className="min-h-9 rounded border border-amber-500 px-2 text-amber-900">
            ↩ Entwurf zurücknehmen
          </button>
        </div>
      )}

      {expanded && (
        <div className={`mt-2 space-y-2 border-t pt-2 text-gray-700 ${stall ? 'text-sm' : 'text-xs'}`} data-no-drag>
          {money && <MoneyBalance money={money} />}
          {verdict && verdict.parts.length > 0 && (
            <p className="text-[0.73rem] text-gray-600">
              {VERDICT_LABEL[verdict.verdict]}: {verdict.points} Punkte ({verdict.parts.map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}`).join(', ')})
            </p>
          )}
          <Section title="Tier">
            <Row k="ID-Nummer" v={card.earTag} />
            {card.name && <Row k="Name" v={card.name} />}
            <Row k="Laufnummer" v={card.laufNr ?? '–'} />
          </Section>

          <Section title="Trächtigkeit">
            {card.pregnancy ? (
              <>
                <Row k="Ergebnis" v={`${RESULT_LABEL[card.pregnancy.result]} (${fmtDate(card.pregnancy.date)})`} />
                {card.pregnancy.method && <Row k="Methode" v={METHOD_LABEL[card.pregnancy.method]} />}
                {card.pregnancy.weeks != null && <Row k="Dauer" v={`${card.pregnancy.weeks} Wochen`} />}
              </>
            ) : (
              <Row k="Ergebnis" v={card.sex === 'w' ? `seit der letzten ${terms.calving} nicht untersucht` : '–'} />
            )}
            {card.expectedBirth && <Row k="Erwartete Geburt" v={fmtDate(card.expectedBirth)} />}
          </Section>

          <Section title={terms.calving}>
            <Row k="Letzte" v={card.lastBirth ? `${fmtDate(card.lastBirth)}${card.daysSinceBirth != null ? ` (vor ${card.daysSinceBirth} Tagen)` : ''}` : '–'} />
            <Row k="Anzahl" v={n0(card.parity)} />
            {card.lastLitterSize != null && <Row k="Letzter Wurf" v={`${card.lastLitterSize} Tiere`} />}
            {card.litterMean != null && <Row k="Wurfgrösse Ø" v={n1(card.litterMean)} />}
            {card.nursing > 0 && <Row k="Saugend" v={String(card.nursing)} />}
          </Section>

          <Section title="Leistung">
            <Row k="Laktation Nr." v={n0(card.lactationNumber)} />
            <Row k="Ggü. Gleichaltrigen" v={card.performanceRel == null ? '–' : `${n0(card.performanceRel)} %`} />
            <Row k="Lebenstagleistung" v={card.ltlMilk == null ? '–' : `${n1(card.ltlMilk, 2)} kg`} />
            <Row k="Zellzahl Ø 12 Mt." v={card.scc12m == null ? '–' : `${n0(card.scc12m)} (1000/ml)`} />
            {card.breedingValue != null ? <Row k="Zuchtwert" v={n0(card.breedingValue)} /> : card.breedingEstimate && <Row k="Zuchtwert (Schätzung)" v={`≈ ${n0(card.breedingEstimate.value)} aus Abstammung`} />}
          </Section>

          <Section title="Ausmerzgründe">
            {card.reasons.length === 0 ? (
              <p className="text-gray-500">keine</p>
            ) : (
              <ul className="space-y-0.5">
                {card.reasons.map((r, i) => (
                  <li key={i}>
                    <span className="mr-1 rounded bg-red-50 px-1 text-[0.73rem] text-red-900">{areaLabel(r.area)}</span>
                    {r.text}
                  </li>
                ))}
              </ul>
            )}
            {card.healthDays12m > 0 && <Row k="Behandlungstage 12 Mt." v={String(card.healthDays12m)} />}
          </Section>

          <Link to={`../tiere/${card.id}`} relative="path" className="flex min-h-11 items-center font-medium text-brand-700 underline">
            Tierdetail öffnen →
          </Link>
        </div>
      )}
    </div>
  )
}

const zwEstimateTitle = (e: NonNullable<BoardCard['breedingEstimate']>) =>
  `Eigene Schätzung aus der Abstammung, kein gemessener Zuchtwert: Mutter ${e.dam ?? 'unbekannt (100 angenommen)'}, Vater ${e.sire ?? 'unbekannt (100 angenommen)'}`

const TREND_ARROW = { steigend: { arrow: '↗', tone: 'text-green-700' }, stabil: { arrow: '→', tone: 'text-gray-600' }, fallend: { arrow: '↘', tone: 'text-red-700' } } as const
const f0 = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('de-CH'))

/** Die gewählten Eigenschaften als kompakte Zeilen unter dem Kopf der Karte. */
function CardProps({
  card,
  fields,
  meat,
  meatLimits,
  milkFeed,
  lastMilk,
  lambValue,
  milkFeedSettings,
}: {
  card: BoardCard
  fields: CardFieldKey[]
  meat: MeatValue | null
  meatLimits?: MeatLimit[]
  milkFeed: MilkFeed | null
  lastMilk: MilkSample | null
  lambValue: CardLambValue | null
  milkFeedSettings?: MilkFeedSettings
}) {
  const has = (k: CardFieldKey) => fields.includes(k)
  const line = (label: string, value: ReactNode, key: string) => (
    <div key={key} className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  )
  const rows: React.ReactNode[] = []
  if (has('milk')) {
    const trend = card.trend ? TREND_ARROW[card.trend] : null
    rows.push(
      <div key="milk" className="flex justify-between gap-2" title="Leistungsindex im Herdenvergleich (Pt, Mittel 100) und in % der Gleichaltrigen; Pfeil = Tendenz über die Laktationen">
        <span className="text-gray-500">Milch</span>
        <span className="text-right font-medium text-gray-900">
          {f0(card.idxPerformance)} Pt – {card.performanceRel == null ? '–' : `${f0(card.performanceRel * 100)} %`}
          {trend && (
            <span className={`ml-1 font-bold ${trend.tone}`} role="img" aria-label={`Tendenz ${card.trend}`} title={`Tendenz über die Laktationen: ${card.trend}`}>
              {trend.arrow}
            </span>
          )}
        </span>
      </div>,
    )
  }
  // Zellzahl: zuerst die effektive Zahl (Ø 12 Monate), dann der Herden-Index (Pt) und in Klammern % der Gleichaltrigen
  if (has('scc'))
    rows.push(
      <div key="scc" className="flex justify-between gap-2" title="Zellzahl Ø 12 Monate (Zellen/ml) · Zellzahl-Index der Herde (Pt, Mittel 100, höher = weniger Zellen) · (in % der Gleichaltrigen, tiefer ist besser)">
        <span className="text-gray-500">Zellzahl</span>
        <span className="text-right font-medium text-gray-900">
          {card.scc12m == null ? '–' : fmtCells(card.scc12m)} · {f0(card.idxScc)} Pt{card.sccRelPeers != null && <span className="font-normal text-gray-700"> ({card.sccRelPeers} %)</span>}
        </span>
      </div>,
    )
  if (has('ltl')) rows.push(line('Lebenstagleistung', card.ltlMilk == null ? '–' : `${n1(card.ltlMilk, 2)} kg`, 'ltl'))
  if (has('zw')) {
    const e = card.breedingEstimate
    if (card.breedingValue == null && e) {
      rows.push(
        <div key="zw" className="flex justify-between gap-2" title={zwEstimateTitle(e)}>
          <span className="text-gray-500">Zuchtwert</span>
          <span className="text-right font-medium italic text-violet-800">≈ {f0(e.value)} <span className="not-italic rounded bg-violet-100 px-1 text-[0.73rem] font-semibold">Schätzung</span></span>
        </div>,
      )
    } else rows.push(line('Zuchtwert', f0(card.breedingValue), 'zw'))
  }
  if (has('lambValue') && card.ageMonths != null && card.ageMonths < 12 && card.sex !== 'm') {
    const v = lambValue
    rows.push(
      <div key="lambValue" className="flex justify-between gap-2" title={v?.tip ?? 'Keine Schätzung: weder bewertete Mutter noch Zuchtwert des Vaters'}>
        <span className="text-gray-500">Zucht-Mehrwert</span>
        <span className={`text-right font-medium ${v && v.francs < 0 ? 'text-red-800' : 'text-gray-900'}`}>
          {v ? `${v.francs > 0 ? '+' : v.francs < 0 ? '−' : '±'}${Math.abs(v.francs).toLocaleString('de-CH')} Fr.` : '–'}
          {v && <span className="font-normal text-gray-600"> (Milch {v.pct > 0 ? '+' : v.pct < 0 ? '−' : '±'}{Math.abs(v.pct).toLocaleString('de-CH')} %)</span>}
        </span>
      </div>,
    )
  }
  if (has('litter')) rows.push(line('Wurf', card.lastLitterSize == null ? '–' : `letzter ${card.lastLitterSize}${card.litterMean != null ? ` · Ø ${n1(card.litterMean)}` : ''}`, 'litter'))
  if (has('lambing')) {
    const b = card.lastBirth
    const days = card.daysSinceBirth
    // am Handy kürzer: ohne Jahr im laufenden Jahr, «T.» statt «Tage»
    const short = b ? `${b.slice(0, 4) === String(new Date().getFullYear()) ? `${b.slice(8, 10)}.${b.slice(5, 7)}.` : fmtDate(b)}${days != null ? ` · ${days} T.` : ''}` : '–'
    const long = b ? `${fmtDate(b)}${days != null ? ` (${days} Tage)` : ''}` : '–'
    rows.push(
      line(
        'Ablammung',
        <>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{long}</span>
        </>,
        'lambing',
      ),
    )
  }
  if (has('service')) {
    const m = card.lastService
    const dm = (d: string) => (d.slice(0, 4) === String(new Date().getFullYear()) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : fmtDate(d))
    const n = card.servicesSinceBirth ?? 0
    const tip = m
      ? [
          `Letzte Belegung ${fmtDate(m.date)}${m.to && m.to !== m.date ? ` bis ${fmtDate(m.to)}` : ''} (${m.daysAgo} Tage)`,
          m.kind ? (m.kind === 'kb' ? 'Künstliche Besamung' : 'Natursprung') : null,
          m.sire ? `Vatertier: ${m.sire}` : null,
          `${n} Belegung${n === 1 ? '' : 'en'} seit der letzten Geburt`,
        ]
          .filter(Boolean)
          .join('\n')
      : 'Keine Belegung erfasst'
    rows.push(
      <div key="service" className="flex justify-between gap-2" title={tip}>
        <span className="text-gray-500">Belegung</span>
        <span className="min-w-0 truncate text-right font-medium text-gray-900">
          {m ? (
            <>
              {dm(m.date)}
              {m.to && m.to !== m.date ? `–${dm(m.to)}` : ''} · {m.daysAgo} T.
              {(m.kind || m.sire) && (
                <span className="font-normal text-gray-600">
                  {' '}
                  · {[m.kind === 'kb' ? 'KB' : m.kind === 'natursprung' ? 'NS' : null, m.sire].filter(Boolean).join(' ')}
                </span>
              )}
              {n > 1 && <span className="font-normal text-gray-600"> ({n}.)</span>}
            </>
          ) : (
            '–'
          )}
        </span>
      </div>,
    )
  }
  if (has('weighings')) {
    // «0.5 kg · ZZ 105' (5 W.)»: zuletzt gewogene Milch dieser Laktation (auch privat, ohne Labor), Zellzahl der letzten
    // Prüfung, Anzahl offizieller Prüfungen (mit Gehalten); Details im Tooltip
    const start = card.lactationStart ?? card.lastBirth
    const milk = lastMilk && (!start || lastMilk.date >= start) ? lastMilk : null
    const scc = card.lastScc ?? null
    const parts = [milk ? `${milk.kg.toLocaleString('de-CH', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kg` : null, scc ? `ZZ ${Math.round(scc.value)}'` : null].filter(Boolean)
    const tip = [
      milk ? `Letzte Wägung ${fmtDate(milk.date)}: ${milk.kg.toLocaleString('de-CH')} kg ${milk.perMilking ? 'je Melkung (Milchwägung, privat)' : 'Tagesmilch (Milchprüfung)'}` : 'Keine Wägung in dieser Laktation',
      scc ? `Zellzahl ${Math.round(scc.value).toLocaleString('de-CH')}'000/ml aus der Prüfung vom ${fmtDate(scc.date)}` : null,
      `${card.weighings} offizielle Prüfungen mit Gehalten (SMG) in dieser Laktation; private Wägungen zählen nicht`,
    ]
      .filter(Boolean)
      .join('\n')
    rows.push(
      <div key="weighings" className="flex justify-between gap-2" title={tip}>
        <span className="text-gray-500">Letzte Wägung</span>
        <span className="text-right font-medium text-gray-900">
          {parts.length ? parts.join(' · ') : '–'}
          {(start || card.weighings > 0) && <span className="font-normal text-gray-600"> ({card.weighings} W.)</span>}
        </span>
      </div>,
    )
  }
  if (has('interval')) rows.push(line('Zwischenablammzeit', card.intervalDays == null ? '–' : `Ø ${card.intervalDays} Tage`, 'interval'))
  if (has('lambMilk')) {
    const m = card.lambMilk
    rows.push(
      line(
        'Milch der Lämmer',
        !m ? '–' : m.lambs === 0 ? `keine Wägungen (${m.missing})` : `≈ ${m.perDay.toFixed(1)} kg/Tag · ${Math.round(m.totalKg)} kg${m.missing > 0 ? ` · ${m.missing} ohne Wägung` : ''}`,
        'lambMilk',
      ),
    )
  }
  if (has('meat')) rows.push(line('Fleischwert', meat ? `≈ ${Math.round(meat.net)} Fr. · ${meat.kind} ${meat.kg} kg` : card.birthDate ? '–' : 'ohne Geburtsdatum', 'meat'))
  if (has('meat') && meat?.boundary)
    rows.push(
      <div key="meatlimit" className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-950">
        ⏳ {meat.boundary.text}
      </div>,
    )
  if (has('meat') && meat) {
    const MEAT_BAR_MAX = meatBarMax(meat)
    const limits = (meatLimits ?? []).filter((l) => l.net > 0 && l.net <= MEAT_BAR_MAX)
    const limitText = limits.map((l) => `${l.title}: ${Math.round(l.net)} Fr.`).join(' · ')
    rows.push(
      <div
        key="meatbar"
        className="relative my-0.5 h-2 w-full rounded-full bg-gray-100"
        role="img"
        aria-label={`Fleischwert ${Math.round(meat.net)} Fr., ${MEAT_BAND_LABEL[meat.band]}. Skala bis ${MEAT_BAR_MAX} Fr.`}
        title={`${MEAT_BAND_LABEL[meat.band]}, ${meat.ageDays} Tage, ${meat.kg} kg SG. Skala 0–${MEAT_BAR_MAX} Fr.${limitText ? ` Grenzen: ${limitText}` : ''}`}
      >
        <div className="h-full rounded-full" style={{ width: `${meatBarPercent(meat.net, MEAT_BAR_MAX)}%`, backgroundColor: meatBarColor(meat.net, MEAT_BAR_MAX) }} />
        {limits.map((l) => (
          <span key={l.key} aria-hidden className="absolute -top-0.5 h-3 w-px bg-gray-800/70" style={{ left: `${(l.net / MEAT_BAR_MAX) * 100}%` }} title={`${l.title}: ${Math.round(l.net)} Fr.`} />
        ))}
      </div>,
    )
  }
  if (has('dailyMilk')) {
    const m = milkFeed
    const kg = (v: number) => v.toFixed(1)
    rows.push(
      <div
        key="dailyMilk"
        className="flex justify-between gap-2"
        title={`Gemolken: letzte Wägung dieser Laktation (Milchwägung × Melkungen pro Tag, oder Milchprüfung), mit Rückgang bis heute.\nLämmer: was die saugenden Lämmer trinken, aus ihrer Wägung (Zuwachs × Faktor), sonst Vorgabe je Anzahl (1: 1.5, 2: 2.5, 3+: 3 kg/Tag, Einstellungen «Milch der Lämmer»). Lämmer am Eimer zählen nicht.`}
      >
        <span className="text-gray-500">Tagesmilch</span>
        <span className="text-right font-medium text-gray-900">
          {!m || m.dailyKg == null ? (
            '–'
          ) : m.lambKg > 0 ? (
            <>
              <span className="font-normal text-gray-700">
                {kg(m.dailyKg)} + {kg(m.lambKg)} 🐑 =
              </span>{' '}
              {kg(m.correctedKg ?? m.dailyKg)} kg
            </>
          ) : (
            <>
              {kg(m.dailyKg)} kg{(card.bucketLambs ?? 0) > 0 && <span className="font-normal text-gray-600"> (🪣 Eimer, ohne Korrektur)</span>}
            </>
          )}
        </span>
      </div>,
    )
  }
  if (has('milkFeed') && milkFeed && milkFeedSettings)
    rows.push(
      line(
        'Milch − Futter',
        <MilkFeedChip m={milkFeed} s={milkFeedSettings} short />,
        'milkFeed',
      ),
    )
  const spark = has('spark') && (card.levels.length > 0 || card.sccLevels.length > 0)
  if (rows.length === 0 && !spark) return null
  return (
    <span className="mt-1 block space-y-0.5 border-t border-gray-100 pt-1 text-[0.73rem]">
      {rows}
      {spark && (
        <span className="flex items-end justify-between gap-2" title="Leistungsniveau je Laktation gegen die Herde (Säulen) und Zellzahl Ø je Laktation (rote Linie)">
          <span className="text-gray-500">Laktationen</span>
          <LactationSpark levels={card.levels} scc={card.sccLevels} />
        </span>
      )}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-0.5 text-[0.73rem] font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{k}</span>
      <span className="text-right text-gray-900">{v}</span>
    </div>
  )
}

/** Geldbilanz: schlachten jetzt gegen behalten bis zur Geburt; der Balken kippt zur besseren Seite. */
function MoneyBalance({ money }: { money: { slaughter: number; keep: number; diff: number } }) {
  const fr = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('de-CH')} Fr.`
  const max = Math.max(Math.abs(money.slaughter), Math.abs(money.keep), 1)
  const w = (v: number) => `${Math.min(100, (Math.abs(v) / max) * 100)}%`
  const slaughterBetter = money.diff > 0
  return (
    <div className="rounded-lg bg-gray-50 p-2" aria-label="Geldbilanz">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-gray-700">🥩 Schlachten jetzt</span>
        <span className={`font-semibold tabular-nums ${money.slaughter >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>{fr(money.slaughter)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-gray-700">🥛 Behalten bis zur Geburt</span>
        <span className={`font-semibold tabular-nums ${money.keep >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>{fr(money.keep)}</span>
      </div>
      <div className="mt-1.5 flex h-2.5 items-stretch" aria-hidden>
        <div className="flex flex-1 justify-end rounded-l-full bg-white">
          <div className={`h-full rounded-l-full ${money.keep >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: w(money.keep) }} />
        </div>
        <div className="w-0.5 bg-gray-500" />
        <div className="flex-1 rounded-r-full bg-white">
          <div className={`h-full rounded-r-full ${money.slaughter >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: w(money.slaughter) }} />
        </div>
      </div>
      <div className="flex justify-between text-[0.73rem] text-gray-500">
        <span>behalten</span>
        <span>schlachten</span>
      </div>
      <p className={`mt-1 rounded px-1.5 py-0.5 text-[0.73rem] font-medium ${slaughterBetter ? 'bg-emerald-100 text-emerald-900' : 'bg-sky-100 text-sky-900'}`}>
        {slaughterBetter ? `Schlachten bringt ≈ ${Math.round(money.diff).toLocaleString('de-CH')} Fr. mehr` : `Behalten bringt ≈ ${Math.round(-money.diff).toLocaleString('de-CH')} Fr. mehr`} (ohne Wert der nächsten Lämmer)
      </p>
    </div>
  )
}
