import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { colorOf } from '@fmis/core/filters/filterModel'
import { areaLabel, SEX_LABEL, weanedOfLastLitter, type BoardCard } from '../lib/board'
import { fmtAge, fmtDate } from '../lib/format'
import { RESULT_LABEL, METHOD_LABEL } from '../lib/pregnancy'
import { speciesTerms } from '../lib/species'
import { meatBarColor, meatBarPercent, MEAT_BAND_LABEL, type MeatLimit, type MeatValue, MEAT_BAR_MAX } from '../lib/meatValue'
import type { CardFieldKey } from '../lib/cardFields'
import LactationSpark from './LactationSpark'
import NursingLambs, { WeanedLambs } from './NursingLambs'

const SEX_ICON: Record<string, string> = { w: '♀', m: '♂', k: '⚲' }

const n1 = (v: number | null, d = 1) => (v == null ? '–' : v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }))
const n0 = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('de-CH'))

/** Die Karte eines Tiers: Nummern, Geschlecht und Geburtsdatum immer; aufgeklappt Trächtigkeit, Geburt,
 * Leistung und Ausmerzgründe. Farben stammen von den eingefärbten Filtern. */
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
  meatLimits,
  fields = [],
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
  /** in einer Merklisten-Spalte: von dieser Liste nehmen (kleiner Knopf neben dem Griff) */
  onRemoveFromList?: () => void
  /** in einer Gruppen-Spalte: Zielgruppen für den kleinen Wechsel-Knopf neben dem Griff (null = ohne Gruppe) */
  groupChoices?: { id: string | null; name: string }[]
  onMoveToGroup?: (groupId: string | null) => void
  /** geschätzter Fleischwert (nur Schafe, wenn aktiv) */
  meat?: MeatValue | null
  /** auf der Karte gewählte Eigenschaften (Menü «Karte») */
  /** Grenzen im Fleischwert-Balken (schwere Aue, schweres Lamm T3/H3/C3); die Skala ist fest */
  meatLimits?: MeatLimit[]
  fields?: CardFieldKey[]
  onDragCard: (e: ReactPointerEvent) => void
  onDragHandle: (e: ReactPointerEvent) => void
}) {
  const terms = speciesTerms(moduleKey)
  const main = colors[0] ? colorOf(colors[0]) : null
  const age = card.birthDate ? fmtAge(card.birthDate, today) : null
  const pregnant = card.pregnancy?.result
  const [picking, setPicking] = useState(false)

  return (
    <div
      data-card={card.id}
      onPointerDown={onDragCard}
      title={filterNames.length ? filterNames.join(', ') : undefined}
      className={`rounded-lg border-2 p-2 shadow-sm ${pendingTo ? 'border-dashed border-amber-500 bg-amber-50' : main ? main.card : 'border-gray-200 bg-white'} ${selected ? 'ring-2 ring-brand-700' : ''} ${canDrag ? 'cursor-grab' : ''}`}
    >
      <div className="flex items-start gap-1">
        <label className="-m-1 grid h-11 w-9 shrink-0 cursor-pointer place-items-center" data-no-drag>
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Tier ${card.laufNr ?? card.shortTag} auswählen`} className="h-5 w-5" />
        </label>
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
          <span className="flex items-baseline gap-2">
            <span className="text-lg font-bold leading-tight text-gray-900">{card.laufNr ?? '–'}</span>
            <span className="truncate text-xs text-gray-600">{card.shortTag}</span>
            {card.sex && <span className="text-sm text-gray-700" title={SEX_LABEL[card.sex]}>{SEX_ICON[card.sex]}</span>}
          </span>
          <span className="block text-xs text-gray-600">
            {card.sex ? `${SEX_LABEL[card.sex]} · ` : ''}
            {card.birthDate ? `geb. ${fmtDate(card.birthDate)}${age ? ` (${age})` : ''}` : 'Geburtsdatum unbekannt'}
          </span>
          <span className="mt-1 flex flex-wrap gap-1 text-[11px] font-medium">
            {pregnant === 'ja' && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-900">trächtig</span>}
            {pregnant === 'nein' && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-orange-900">leer</span>}
            {pregnant === 'unsicher' && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-800">unsicher</span>}
            {card.dry && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-800">trocken</span>}
            <NursingLambs count={card.nursing} young={terms.singular === 'Aue' ? 'Lämmer' : 'Kälber'} />
            {fields.includes('weaned') && card.litterAlive != null && (
              <WeanedLambs count={weanedOfLastLitter(card)} alive={card.litterAlive} dead={card.litterDead ?? 0} young={terms.singular === 'Aue' ? 'Lämmer' : 'Kälber'} />
            )}
            {card.reasons.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-900">⚠ {card.reasons.length}</span>}
            {pendingTo && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-950">→ {pendingTo} (Entwurf)</span>}
            {meat && !fields.includes('meat') && (
              <span className={`rounded px-1.5 py-0.5 ${meat.kind === 'Lamm' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-900'}`} title={`${meat.kind}, ${meat.ageDays} Tage am Schlachttermin, ca. ${meat.kg} kg SG, ${meat.pricePerKg.toFixed(2)} Fr./kg, nach Abzügen`}>
                ≈ {Math.round(meat.net)} Fr. · {meat.kind}
              </span>
            )}
          </span>
          {fields.length > 0 && <CardProps card={card} fields={fields} meat={meat ?? null} meatLimits={meatLimits} />}
        </button>
        {canDrag && (
          <span
            onPointerDown={onDragHandle}
            style={{ touchAction: 'none' }}
            className="grid h-11 w-9 shrink-0 cursor-grab place-items-center rounded text-xl text-gray-500 active:bg-gray-100"
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
            className={`grid h-11 w-8 shrink-0 place-items-center rounded text-base active:bg-gray-100 ${picking ? 'bg-sky-100 text-sky-900' : 'text-gray-500'}`}
          >
            ⇄
          </button>
        )}
        {onRemoveFromList && (
          <button type="button" data-no-drag onClick={onRemoveFromList} aria-label="Von der Liste nehmen" title="Von der Liste nehmen" className="grid h-11 w-8 shrink-0 place-items-center rounded text-base text-gray-500 active:bg-red-50 active:text-red-700">
            ✕
          </button>
        )}
      </div>

      {picking && onMoveToGroup && groupChoices && (
        <div className="mt-1 flex items-center gap-1" data-no-drag>
          <select
            autoFocus
            defaultValue=""
            aria-label="In Gruppe verschieben (Entwurf)"
            onChange={(e) => {
              if (e.target.value === '') return
              setPicking(false)
              onMoveToGroup(e.target.value === 'none' ? null : e.target.value)
            }}
            className="min-h-9 min-w-0 flex-1 rounded border border-gray-300 bg-white px-1 text-xs"
          >
            <option value="">Gruppe wählen…</option>
            {groupChoices.map((g) => (
              <option key={g.id ?? 'none'} value={g.id ?? 'none'}>
                {g.name}
              </option>
            ))}
          </select>
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
        <div className="mt-2 space-y-2 border-t pt-2 text-xs text-gray-700" data-no-drag>
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
                    <span className="mr-1 rounded bg-red-50 px-1 text-[11px] text-red-900">{areaLabel(r.area)}</span>
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
function CardProps({ card, fields, meat, meatLimits }: { card: BoardCard; fields: CardFieldKey[]; meat: MeatValue | null; meatLimits?: MeatLimit[] }) {
  const has = (k: CardFieldKey) => fields.includes(k)
  const line = (label: string, value: string, key: string) => (
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
  if (has('scc')) rows.push(line('Zellzahl', `Herde ${f0(card.idxScc)} · Gleichalt. ${card.sccRelPeers == null ? '–' : `${card.sccRelPeers} %`} · Ø ${f0(card.scc12m)}`, 'scc'))
  if (has('ltl')) rows.push(line('Lebenstagleistung', card.ltlMilk == null ? '–' : `${n1(card.ltlMilk, 2)} kg`, 'ltl'))
  if (has('zw')) {
    const e = card.breedingEstimate
    if (card.breedingValue == null && e) {
      rows.push(
        <div key="zw" className="flex justify-between gap-2" title={zwEstimateTitle(e)}>
          <span className="text-gray-500">Zuchtwert</span>
          <span className="text-right font-medium italic text-violet-800">≈ {f0(e.value)} <span className="not-italic rounded bg-violet-100 px-1 text-[10px] font-semibold">Schätzung</span></span>
        </div>,
      )
    } else rows.push(line('Zuchtwert', f0(card.breedingValue), 'zw'))
  }
  if (has('litter')) rows.push(line('Wurf', card.lastLitterSize == null ? '–' : `letzter ${card.lastLitterSize}${card.litterMean != null ? ` · Ø ${n1(card.litterMean)}` : ''}`, 'litter'))
  if (has('lambing')) rows.push(line('Ablammung', card.lastBirth ? `${fmtDate(card.lastBirth)}${card.daysSinceBirth != null ? ` (${card.daysSinceBirth} Tage)` : ''}` : '–', 'lambing'))
  if (has('weighings')) rows.push(line('Wägungen', card.lastBirth || card.weighings > 0 ? String(card.weighings) : '–', 'weighings'))
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
  if (has('meat') && meat) {
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
        <div className="h-full rounded-full" style={{ width: `${meatBarPercent(meat.net)}%`, backgroundColor: meatBarColor(meat.net) }} />
        {limits.map((l) => (
          <span key={l.key} aria-hidden className="absolute -top-0.5 h-3 w-px bg-gray-800/70" style={{ left: `${(l.net / MEAT_BAR_MAX) * 100}%` }} title={`${l.title}: ${Math.round(l.net)} Fr.`} />
        ))}
      </div>,
    )
  }
  const spark = has('spark') && card.levels.length > 0
  if (rows.length === 0 && !spark) return null
  return (
    <span className="mt-1 block space-y-0.5 border-t border-gray-100 pt-1 text-[11px]">
      {rows}
      {spark && (
        <span className="flex items-end justify-between gap-2" title="Leistungsniveau je Laktation gegen die Herde">
          <span className="text-gray-500">Laktationen</span>
          <LactationSpark levels={card.levels} />
        </span>
      )}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
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
