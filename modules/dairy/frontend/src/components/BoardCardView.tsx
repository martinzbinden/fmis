import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { colorOf } from '@fmis/core/filters/filterModel'
import { areaLabel, SEX_LABEL, type BoardCard } from '../lib/board'
import { fmtAge, fmtDate } from '../lib/format'
import { RESULT_LABEL, METHOD_LABEL } from '../lib/pregnancy'
import { speciesTerms } from '../lib/species'
import type { MeatValue } from '../lib/meatValue'
import type { CardFieldKey } from '../lib/cardFields'
import LactationSpark from './LactationSpark'
import NursingLambs from './NursingLambs'

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
  meat,
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
  /** in einer Merklisten-Spalte: von dieser Liste nehmen */
  onRemoveFromList?: () => void
  /** geschätzter Fleischwert (nur Schafe, wenn aktiv) */
  meat?: MeatValue | null
  /** auf der Karte gewählte Eigenschaften (Menü «Karte») */
  fields?: CardFieldKey[]
  onDragCard: (e: ReactPointerEvent) => void
  onDragHandle: (e: ReactPointerEvent) => void
}) {
  const terms = speciesTerms(moduleKey)
  const main = colors[0] ? colorOf(colors[0]) : null
  const age = card.birthDate ? fmtAge(card.birthDate, today) : null
  const pregnant = card.pregnancy?.result

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
            {card.reasons.length > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-900">⚠ {card.reasons.length}</span>}
            {pendingTo && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-950">→ {pendingTo} (Entwurf)</span>}
            {meat && (
              <span className={`rounded px-1.5 py-0.5 ${meat.kind === 'Lamm' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-900'}`} title={`${meat.kind}, ${meat.ageDays} Tage am Schlachttermin, ca. ${meat.kg} kg SG, ${meat.pricePerKg.toFixed(2)} Fr./kg, nach Abzügen`}>
                ≈ {Math.round(meat.net)} Fr. · {meat.kind}
              </span>
            )}
          </span>
          {fields.length > 0 && <CardProps card={card} fields={fields} />}
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
      </div>

      {colors.length > 1 && (
        <div className="mt-1 flex gap-1" aria-hidden>
          {colors.map((c) => (
            <span key={c} className={`h-1.5 flex-1 rounded-full ${colorOf(c).dot}`} />
          ))}
        </div>
      )}

      {(onUndoDraft || onRemoveFromList) && (
        <div className="mt-1 flex gap-2 text-xs" data-no-drag>
          {onUndoDraft && (
            <button type="button" onClick={onUndoDraft} className="min-h-9 rounded border border-amber-500 px-2 text-amber-900">
              ↩ Entwurf zurücknehmen
            </button>
          )}
          {onRemoveFromList && (
            <button type="button" onClick={onRemoveFromList} className="min-h-9 rounded border border-gray-300 px-2 text-gray-700">
              ✕ von der Liste nehmen
            </button>
          )}
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
            {card.breedingValue != null && <Row k="Zuchtwert" v={n0(card.breedingValue)} />}
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

const f0 = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('de-CH'))

/** Die gewählten Eigenschaften als kompakte Zeilen unter dem Kopf der Karte. */
function CardProps({ card, fields }: { card: BoardCard; fields: CardFieldKey[] }) {
  const has = (k: CardFieldKey) => fields.includes(k)
  const line = (label: string, value: string, key: string) => (
    <div key={key} className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  )
  const rows: React.ReactNode[] = []
  if (has('milk')) rows.push(line('Milch', `Herde ${f0(card.idxPerformance)} · Gleichalt. ${card.performanceRel == null ? '–' : `${f0(card.performanceRel * 100)} %`}`, 'milk'))
  if (has('scc')) rows.push(line('Zellzahl', `Herde ${f0(card.idxScc)} · Gleichalt. ${card.sccRelPeers == null ? '–' : `${card.sccRelPeers} %`} · Ø ${f0(card.scc12m)}`, 'scc'))
  if (has('ltl')) rows.push(line('Lebenstagleistung', card.ltlMilk == null ? '–' : `${n1(card.ltlMilk, 2)} kg`, 'ltl'))
  if (has('zw')) rows.push(line('Zuchtwert', f0(card.breedingValue), 'zw'))
  if (has('litter')) rows.push(line('Wurf', card.lastLitterSize == null ? '–' : `letzter ${card.lastLitterSize}${card.litterMean != null ? ` · Ø ${n1(card.litterMean)}` : ''}`, 'litter'))
  if (has('interval')) rows.push(line('Zwischenablammzeit', card.intervalDays == null ? '–' : `Ø ${card.intervalDays} Tage`, 'interval'))
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
